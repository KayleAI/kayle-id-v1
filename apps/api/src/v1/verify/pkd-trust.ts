import { Set as Asn1Set, fromBER, OctetString, Sequence } from "asn1js";
import {
  AuthorityKeyIdentifier,
  Certificate,
  CertificateRevocationList,
  ContentInfo,
  SignedData,
  setEngine,
} from "pkijs";

const ICAO_MASTER_LIST_OID = "2.23.136.1.1.2";
const PKD_TRUST_BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000;
const PKD_TRUST_BUNDLE_VERSION = 1;
const PKD_TRUST_R2_KEY = "verify/pkd-trust/latest.json";
const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
const AUTHORITY_KEY_IDENTIFIER_OID = "2.5.29.35";

type PkdTrustR2ObjectBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpEtag: string;
};

type PkdTrustR2Bucket = {
  get(key: string): Promise<PkdTrustR2ObjectBody | null>;
};

type PkdTrustBundleLoader = () => Promise<PkdTrustBundle | null>;

export type PkdTrustBundleSource = {
  countryCode: string | null;
  dn: string;
};

export type PkdCertificateRecord = {
  akiHex: string | null;
  derBase64: string;
  issuerKey: string;
  issuerName: string;
  notAfter: string;
  notBefore: string;
  serialNumberHex: string;
  skiHex: string | null;
  sourceCountryCode: string | null;
  sourceDn: string;
  subjectKey: string;
  subjectName: string;
};

export type PkdCscaRecord = PkdCertificateRecord & {
  masterListSources: PkdTrustBundleSource[];
};

export type PkdCrlRecord = {
  akiHex: string | null;
  derBase64: string;
  issuerKey: string;
  issuerName: string;
  nextUpdate: string | null;
  revokedSerialNumbersHex: string[];
  sourceCountryCode: string | null;
  sourceDn: string;
  thisUpdate: string;
};

export type PkdTrustBundleJson = {
  counts: {
    cscas: number;
    crls: number;
    dscs: number;
    ignoredBcsc: number;
    ignoredBcscNc: number;
  };
  cscas: PkdCscaRecord[];
  crls: PkdCrlRecord[];
  dscs: PkdCertificateRecord[];
  generatedAt: string;
  sources: {
    masterListsLdif: {
      path: string;
      version: string | null;
    };
    objectLdif: {
      path: string;
      version: string | null;
    };
  };
  version: typeof PKD_TRUST_BUNDLE_VERSION;
};

export type PkdTrustBundleCertificate = {
  cert: Certificate;
  record: PkdCertificateRecord | PkdCscaRecord;
};

export type PkdTrustBundleCrl = {
  crl: CertificateRevocationList;
  record: PkdCrlRecord;
};

export type PkdTrustBundle = {
  cscas: PkdTrustBundleCertificate[];
  cscasBySubjectKey: Map<string, PkdTrustBundleCertificate[]>;
  cscasBySkiHex: Map<string, PkdTrustBundleCertificate[]>;
  crls: PkdTrustBundleCrl[];
  crlsByAkiHex: Map<string, PkdTrustBundleCrl[]>;
  crlsByIssuerKey: Map<string, PkdTrustBundleCrl[]>;
  dscRecordsByIssuerSerial: Map<string, PkdCertificateRecord>;
  dscRecordsBySkiHex: Map<string, PkdCertificateRecord[]>;
  dscsBySkiHex: Map<string, PkdTrustBundleCertificate[]>;
  dscsByIssuerSerial: Map<string, PkdTrustBundleCertificate>;
  raw: PkdTrustBundleJson;
};

type PkdTrustBundleCache = {
  bundle: PkdTrustBundle | null;
  etag: string | null;
  expiresAt: number;
};

let pkijsConfigured = false;
let trustBundleLoader: PkdTrustBundleLoader | null = null;
let configuredR2Bucket: PkdTrustR2Bucket | null = null;
let trustBundleCache: PkdTrustBundleCache = {
  bundle: null,
  etag: null,
  expiresAt: 0,
};

function exactBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bufferBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

export function hexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    ""
  );
}

function asn1Buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function decodeBase64(value: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const decoded = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    decoded[index] = binary.charCodeAt(index);
  }

  return decoded;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";

  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function shortOid(oid: string): string {
  switch (oid) {
    case "2.5.4.3":
      return "CN";
    case "2.5.4.6":
      return "C";
    case "2.5.4.7":
      return "L";
    case "2.5.4.8":
      return "ST";
    case "2.5.4.10":
      return "O";
    case "2.5.4.11":
      return "OU";
    case "2.5.4.5":
      return "SERIALNUMBER";
    case "1.2.840.113549.1.9.1":
      return "EMAILADDRESS";
    default:
      return oid;
  }
}

function attributeValueText(value: unknown): string {
  const candidate = value as {
    toJSON?: () => unknown;
    valueBlock?: {
      value?: string;
      valueDec?: number;
    };
  };

  if (typeof candidate.valueBlock?.value === "string") {
    return candidate.valueBlock.value;
  }

  if (typeof candidate.valueBlock?.valueDec === "number") {
    return String(candidate.valueBlock.valueDec);
  }

  return JSON.stringify(candidate.toJSON?.() ?? {});
}

function formatRelativeDistinguishedName(
  name: Certificate["subject"] | CertificateRevocationList["issuer"]
): string {
  return name.typesAndValues
    .map(
      (entry) => `${shortOid(entry.type)}=${attributeValueText(entry.value)}`
    )
    .join(", ");
}

export function relativeDistinguishedNameKey(
  name: Certificate["subject"] | CertificateRevocationList["issuer"]
): string {
  return hexBytes(new Uint8Array(name.toSchema().toBER(false)));
}

function parseOctetString(value: ArrayBuffer): Uint8Array | null {
  const parsed = fromBER(value);

  if (parsed.offset === -1 || !(parsed.result instanceof OctetString)) {
    return null;
  }

  return octetStringBytes(parsed.result);
}

function octetStringBytes(value: OctetString): Uint8Array {
  if (!value.idBlock.isConstructed) {
    return exactBytes(value.valueBlock.valueHexView);
  }

  const parts = value.valueBlock.value.map((child) => {
    if (!(child instanceof OctetString)) {
      throw new Error("invalid_octet_string_child");
    }

    return octetStringBytes(child);
  });
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return combined;
}

function parseAuthorityKeyIdentifier(
  value: ArrayBuffer
): AuthorityKeyIdentifier | null {
  const parsed = fromBER(value);

  if (parsed.offset === -1) {
    return null;
  }

  try {
    return new AuthorityKeyIdentifier({
      schema: parsed.result,
    });
  } catch {
    return null;
  }
}

async function computeSubjectKeyIdentifier(cert: Certificate): Promise<string> {
  return hexBytes(new Uint8Array(await cert.getKeyHash("SHA-1")));
}

export function subjectKeyIdentifierHex(
  cert: Certificate
): Promise<string | null> {
  const subjectKeyIdentifier = cert.extensions?.find(
    (extension) => extension.extnID === SUBJECT_KEY_IDENTIFIER_OID
  );
  const parsedValue = subjectKeyIdentifier
    ? parseOctetString(subjectKeyIdentifier.extnValue.valueBlock.valueHex)
    : null;

  if (parsedValue) {
    return Promise.resolve(hexBytes(parsedValue));
  }

  return Promise.resolve(null);
}

export async function subjectKeyIdentifierHexOrKeyHash(
  cert: Certificate
): Promise<string> {
  return (
    (await subjectKeyIdentifierHex(cert)) ?? computeSubjectKeyIdentifier(cert)
  );
}

export function authorityKeyIdentifierHex(input: {
  extensions?:
    | Certificate["extensions"]
    | CertificateRevocationList["crlExtensions"];
}): string | null {
  const extensions = Array.isArray(input.extensions)
    ? input.extensions
    : input.extensions?.extensions;
  const authorityKeyIdentifier = extensions?.find(
    (extension) => extension.extnID === AUTHORITY_KEY_IDENTIFIER_OID
  );
  const parsed = authorityKeyIdentifier
    ? parseAuthorityKeyIdentifier(
        authorityKeyIdentifier.extnValue.valueBlock.valueHex
      )
    : null;
  const keyIdentifier = parsed?.keyIdentifier;

  return keyIdentifier ? hexBytes(keyIdentifier.valueBlock.valueHexView) : null;
}

export function parseDerCertificate(bytes: Uint8Array): Certificate {
  ensurePkijsEngine();
  const decoded = fromBER(asn1Buffer(bytes));

  if (decoded.offset === -1) {
    throw new Error("certificate_parse_failed");
  }

  return new Certificate({
    schema: decoded.result,
  });
}

export function parseDerCertificateRevocationList(
  bytes: Uint8Array
): CertificateRevocationList {
  ensurePkijsEngine();
  const decoded = fromBER(asn1Buffer(bytes));

  if (decoded.offset === -1) {
    throw new Error("crl_parse_failed");
  }

  return new CertificateRevocationList({
    schema: decoded.result,
  });
}

function dscIssuerSerialKey(
  issuerKey: string,
  serialNumberHex: string
): string {
  return `${issuerKey}:${serialNumberHex.toLowerCase()}`;
}

function addIndexedValue<T>(
  index: Map<string, T[]>,
  key: string | null,
  value: T
): void {
  if (!key) {
    return;
  }

  const existing = index.get(key);

  if (existing) {
    existing.push(value);
    return;
  }

  index.set(key, [value]);
}

function getR2Bucket(env: unknown): PkdTrustR2Bucket | null {
  if (!env || typeof env !== "object") {
    return null;
  }

  const candidate = Reflect.get(env, "STORAGE");

  return candidate &&
    typeof candidate === "object" &&
    typeof Reflect.get(candidate, "get") === "function"
    ? (candidate as PkdTrustR2Bucket)
    : null;
}

function parseTextJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function pkdTrustBundleCacheExpired(): boolean {
  return trustBundleCache.expiresAt <= Date.now();
}

async function loadTrustBundleFromR2Bucket(
  bucket: PkdTrustR2Bucket
): Promise<PkdTrustBundle | null> {
  if (trustBundleCache.bundle && !pkdTrustBundleCacheExpired()) {
    return trustBundleCache.bundle;
  }

  const object = await bucket.get(PKD_TRUST_R2_KEY);

  if (!object) {
    clearPkdTrustBundleCache();
    return null;
  }

  if (
    trustBundleCache.bundle &&
    trustBundleCache.etag &&
    object.httpEtag === trustBundleCache.etag
  ) {
    trustBundleCache.expiresAt = Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS;
    return trustBundleCache.bundle;
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  const parsed = parseTextJson(bytes);
  const hydrated = await hydratePkdTrustBundle(parsed);

  trustBundleCache = {
    bundle: hydrated,
    etag: object.httpEtag,
    expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
  };

  return hydrated;
}

export function ensurePkijsEngine(): void {
  if (pkijsConfigured) {
    return;
  }

  setEngine("kayle-id-worker", crypto, crypto.subtle);
  pkijsConfigured = true;
}

export function clearPkdTrustBundleCache(): void {
  trustBundleCache = {
    bundle: null,
    etag: null,
    expiresAt: 0,
  };
}

export function configurePkdTrustBundleLoader(
  loader: PkdTrustBundleLoader | null
): void {
  configuredR2Bucket = null;
  trustBundleLoader = loader;
  clearPkdTrustBundleCache();
}

export function configurePkdTrustBundleLoaderFromEnv(env: unknown): void {
  const bucket = getR2Bucket(env);

  if (!bucket) {
    if (!(configuredR2Bucket || trustBundleLoader)) {
      return;
    }

    configurePkdTrustBundleLoader(null);
    return;
  }

  if (configuredR2Bucket === bucket && trustBundleLoader) {
    return;
  }

  configuredR2Bucket = bucket;
  trustBundleLoader = () => loadTrustBundleFromR2Bucket(bucket);
  clearPkdTrustBundleCache();
}

export function loadPkdTrustBundle(): Promise<PkdTrustBundle | null> {
  return trustBundleLoader ? trustBundleLoader() : Promise.resolve(null);
}

export async function createPkdCertificateRecord({
  cert,
  derBytes,
  masterListSources,
  sourceCountryCode,
  sourceDn,
}: {
  cert: Certificate;
  derBytes: Uint8Array;
  masterListSources?: PkdTrustBundleSource[];
  sourceCountryCode: string | null;
  sourceDn: string;
}): Promise<PkdCertificateRecord | PkdCscaRecord> {
  const baseRecord = {
    akiHex: authorityKeyIdentifierHex(cert),
    derBase64: encodeBase64(derBytes),
    issuerKey: relativeDistinguishedNameKey(cert.issuer),
    issuerName: formatRelativeDistinguishedName(cert.issuer),
    notAfter: cert.notAfter.value.toISOString(),
    notBefore: cert.notBefore.value.toISOString(),
    serialNumberHex: hexBytes(
      new Uint8Array(cert.serialNumber.valueBlock.valueHex)
    ),
    skiHex: await subjectKeyIdentifierHex(cert),
    sourceCountryCode,
    sourceDn,
    subjectKey: relativeDistinguishedNameKey(cert.subject),
    subjectName: formatRelativeDistinguishedName(cert.subject),
  } satisfies PkdCertificateRecord;

  return masterListSources
    ? {
        ...baseRecord,
        masterListSources,
      }
    : baseRecord;
}

export function createPkdCrlRecord({
  crl,
  derBytes,
  sourceCountryCode,
  sourceDn,
}: {
  crl: CertificateRevocationList;
  derBytes: Uint8Array;
  sourceCountryCode: string | null;
  sourceDn: string;
}): PkdCrlRecord {
  return {
    akiHex: authorityKeyIdentifierHex({
      extensions: crl.crlExtensions,
    }),
    derBase64: encodeBase64(derBytes),
    issuerKey: relativeDistinguishedNameKey(crl.issuer),
    issuerName: formatRelativeDistinguishedName(crl.issuer),
    nextUpdate: crl.nextUpdate?.value.toISOString() ?? null,
    revokedSerialNumbersHex:
      crl.revokedCertificates?.map((entry) =>
        hexBytes(new Uint8Array(entry.userCertificate.valueBlock.valueHex))
      ) ?? [],
    sourceCountryCode,
    sourceDn,
    thisUpdate: crl.thisUpdate.value.toISOString(),
  };
}

export function parsePkdTrustBundleJson(value: unknown): PkdTrustBundleJson {
  if (!value || typeof value !== "object") {
    throw new Error("pkd_trust_bundle_invalid");
  }

  const bundle = value as PkdTrustBundleJson;

  if (bundle.version !== PKD_TRUST_BUNDLE_VERSION) {
    throw new Error("pkd_trust_bundle_version_invalid");
  }

  if (
    !(
      Array.isArray(bundle.cscas) &&
      Array.isArray(bundle.crls) &&
      Array.isArray(bundle.dscs)
    )
  ) {
    throw new Error("pkd_trust_bundle_invalid");
  }

  return bundle;
}

export function hydratePkdTrustBundle(value: unknown): PkdTrustBundle {
  const raw = parsePkdTrustBundleJson(value);
  const cscas: PkdTrustBundleCertificate[] = [];
  const crls: PkdTrustBundleCrl[] = [];
  const cscasBySubjectKey = new Map<string, PkdTrustBundleCertificate[]>();
  const cscasBySkiHex = new Map<string, PkdTrustBundleCertificate[]>();
  const crlsByAkiHex = new Map<string, PkdTrustBundleCrl[]>();
  const crlsByIssuerKey = new Map<string, PkdTrustBundleCrl[]>();
  const dscRecordsByIssuerSerial = new Map<string, PkdCertificateRecord>();
  const dscRecordsBySkiHex = new Map<string, PkdCertificateRecord[]>();

  for (const record of raw.cscas) {
    const cert = parseDerCertificate(decodeBase64(record.derBase64));
    const entry = { cert, record };
    cscas.push(entry);
    addIndexedValue(cscasBySubjectKey, record.subjectKey, entry);
    addIndexedValue(cscasBySkiHex, record.skiHex, entry);
  }

  for (const record of raw.crls) {
    const crl = parseDerCertificateRevocationList(
      decodeBase64(record.derBase64)
    );
    const entry = { crl, record };
    crls.push(entry);
    addIndexedValue(crlsByIssuerKey, record.issuerKey, entry);
    addIndexedValue(crlsByAkiHex, record.akiHex, entry);
  }

  for (const record of raw.dscs) {
    dscRecordsByIssuerSerial.set(
      dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
      record
    );
    addIndexedValue(dscRecordsBySkiHex, record.skiHex, record);
  }

  return {
    cscas,
    cscasBySubjectKey,
    cscasBySkiHex,
    crls,
    crlsByAkiHex,
    crlsByIssuerKey,
    dscRecordsByIssuerSerial,
    dscRecordsBySkiHex,
    dscsByIssuerSerial: new Map<string, PkdTrustBundleCertificate>(),
    dscsBySkiHex: new Map<string, PkdTrustBundleCertificate[]>(),
    raw,
  };
}

export function resolvePkdDscCertificate(
  bundle: PkdTrustBundle,
  issuerKey: string,
  serialNumberHex: string
): PkdTrustBundleCertificate | null {
  const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
  const cached = bundle.dscsByIssuerSerial.get(key);

  if (cached) {
    return cached;
  }

  const record = bundle.dscRecordsByIssuerSerial.get(key);

  if (!record) {
    return null;
  }

  const entry = {
    cert: parseDerCertificate(decodeBase64(record.derBase64)),
    record,
  };
  bundle.dscsByIssuerSerial.set(key, entry);
  return entry;
}

export function resolvePkdDscCertificatesBySki(
  bundle: PkdTrustBundle,
  skiHex: string
): PkdTrustBundleCertificate[] {
  const normalizedSkiHex = skiHex.toLowerCase();
  const cached = bundle.dscsBySkiHex.get(normalizedSkiHex);

  if (cached) {
    return [...cached];
  }

  const records = bundle.dscRecordsBySkiHex.get(normalizedSkiHex) ?? [];
  const entries = records.map((record) => ({
    cert: parseDerCertificate(decodeBase64(record.derBase64)),
    record,
  }));

  bundle.dscsBySkiHex.set(normalizedSkiHex, entries);
  return [...entries];
}

export function extractCscaCertificatesFromMasterList(
  bytes: Uint8Array
): Certificate[] {
  ensurePkijsEngine();
  const decoded = fromBER(bufferBytes(bytes));

  if (decoded.offset === -1) {
    throw new Error("master_list_parse_failed");
  }

  const contentInfo = new ContentInfo({
    schema: decoded.result,
  });

  if (contentInfo.contentType !== "1.2.840.113549.1.7.2") {
    throw new Error("master_list_content_type_invalid");
  }

  const signedData = new SignedData({
    schema: contentInfo.content,
  });

  if (signedData.encapContentInfo.eContentType !== ICAO_MASTER_LIST_OID) {
    throw new Error("master_list_econtent_type_invalid");
  }

  const eContent = signedData.encapContentInfo.eContent;

  if (!eContent) {
    throw new Error("master_list_content_missing");
  }

  const masterListBytes = octetStringBytes(eContent);
  const masterListAsn1 = fromBER(asn1Buffer(masterListBytes));

  if (
    masterListAsn1.offset === -1 ||
    !(masterListAsn1.result instanceof Sequence)
  ) {
    throw new Error("master_list_content_invalid");
  }

  const [, certificateSet] = masterListAsn1.result.valueBlock.value;

  if (!(certificateSet instanceof Asn1Set)) {
    throw new Error("master_list_certificates_missing");
  }

  return certificateSet.valueBlock.value.map((entry) => {
    try {
      return new Certificate({
        schema: entry,
      });
    } catch {
      throw new Error("master_list_certificate_invalid");
    }
  });
}

export function pkdTrustBundleKey(): string {
  return PKD_TRUST_R2_KEY;
}

export function pkdTrustBundleVersion(): typeof PKD_TRUST_BUNDLE_VERSION {
  return PKD_TRUST_BUNDLE_VERSION;
}
