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
const PKD_TRUST_BUNDLE_VERSION = 2;
const PKD_TRUST_R2_KEY = "verify/pkd-trust/latest.json";
const PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX = "verify/pkd-trust/dsc-country";
const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
const AUTHORITY_KEY_IDENTIFIER_OID = "2.5.29.35";

type PkdTrustR2ObjectBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpEtag: string;
};

type PkdTrustR2Bucket = {
  get(key: string): Promise<PkdTrustR2ObjectBody | null>;
};

type PkdTrustD1PreparedStatement = {
  all<T = Record<string, unknown>>(): Promise<{
    results?: T[];
  }>;
  bind(...values: unknown[]): PkdTrustD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

type PkdTrustD1Database = {
  prepare(query: string): PkdTrustD1PreparedStatement;
};

type PkdTrustBundleLoader = () => Promise<PkdTrustBundle | null>;
type PkdTrustBundleDscSegmentLoader = (
  segmentKey: string
) => Promise<PkdTrustBundleDscSegment | null>;
type PkdTrustBundleDscRecordByIssuerSerialLoader = (
  issuerKey: string,
  serialNumberHex: string
) => Promise<PkdCertificateRecord | null>;
type PkdTrustBundleDscRecordsBySkiLoader = (
  skiHex: string
) => Promise<PkdCertificateRecord[]>;

export type PkdTrustBundleSource = {
  countryCode: string | null;
  dn: string;
};

export type PkdTrustBundleDscSegmentIndex = {
  issuerSerial: Record<string, string[]>;
  skiHex: Record<string, string[]>;
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
  dscSegmentIndex?: PkdTrustBundleDscSegmentIndex | null;
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

export type PkdTrustBundleDscSegmentJson = {
  dscs: PkdCertificateRecord[];
  segmentKey: string;
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
  dscSegmentKeysByIssuerSerial: Map<string, string[]>;
  dscSegmentKeysBySkiHex: Map<string, string[]>;
  dscSegments: Map<string, PkdTrustBundleDscSegment>;
  dscRecordLoaderByIssuerSerial: PkdTrustBundleDscRecordByIssuerSerialLoader | null;
  dscRecordsLoaderBySkiHex: PkdTrustBundleDscRecordsBySkiLoader | null;
  dscSegmentLoader: PkdTrustBundleDscSegmentLoader | null;
  dscsBySkiHex: Map<string, PkdTrustBundleCertificate[]>;
  dscsByIssuerSerial: Map<string, PkdTrustBundleCertificate>;
  raw: PkdTrustBundleJson;
};

export type PkdTrustBundleDscSegment = {
  dscRecordsByIssuerSerial: Map<string, PkdCertificateRecord>;
  dscRecordsBySkiHex: Map<string, PkdCertificateRecord[]>;
  dscsByIssuerSerial: Map<string, PkdTrustBundleCertificate>;
  dscsBySkiHex: Map<string, PkdTrustBundleCertificate[]>;
  raw: PkdTrustBundleDscSegmentJson;
};

type TrustStoreMetadataRow = {
  cscaCount: number;
  crlCount: number;
  dscCount: number;
  generatedAt: string;
  ignoredBcsc: number;
  ignoredBcscNc: number;
  masterListsLdifPath: string;
  masterListsLdifVersion: string | null;
  objectLdifPath: string;
  objectLdifVersion: string | null;
  version: number;
};

type TrustStoreCscaRow = Omit<PkdCscaRecord, "masterListSources"> & {
  masterListSourcesJson: string;
};

type TrustStoreCrlRow = {
  akiHex: string | null;
  derBase64: string;
  id: number;
  issuerKey: string;
  issuerName: string;
  nextUpdate: string | null;
  sourceCountryCode: string | null;
  sourceDn: string;
  thisUpdate: string;
};

type TrustStoreCrlRevocationRow = {
  crlId: number;
  revokedSerialNumberHex: string;
};

type PkdTrustBundleCache = {
  bundle: PkdTrustBundle | null;
  etag: string | null;
  expiresAt: number;
};

const INLINE_PKD_TRUST_BUNDLE_ENV_KEY = "VERIFY_PKD_TRUST_BUNDLE_JSON";
const TRUST_STORE_METADATA_ID = 1;

const SELECT_TRUST_STORE_METADATA_SQL = `
  SELECT
    generated_at AS generatedAt,
    version,
    object_ldif_path AS objectLdifPath,
    object_ldif_version AS objectLdifVersion,
    master_lists_ldif_path AS masterListsLdifPath,
    master_lists_ldif_version AS masterListsLdifVersion,
    csca_count AS cscaCount,
    dsc_count AS dscCount,
    crl_count AS crlCount,
    ignored_bcsc AS ignoredBcsc,
    ignored_bcsc_nc AS ignoredBcscNc
  FROM trust_store_metadata
  WHERE id = ?
`;

const SELECT_TRUST_STORE_CSCAS_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    master_list_sources_json AS masterListSourcesJson,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_cscas
`;

const SELECT_TRUST_STORE_CRLS_SQL = `
  SELECT
    id,
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    next_update AS nextUpdate,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    this_update AS thisUpdate
  FROM trust_store_crls
`;

const SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL = `
  SELECT
    crl_id AS crlId,
    revoked_serial_number_hex AS revokedSerialNumberHex
  FROM trust_store_crl_revocations
`;

const SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_dscs
  WHERE issuer_key = ? AND serial_number_hex = ?
  LIMIT 1
`;

const SELECT_TRUST_STORE_DSCS_BY_SKI_SQL = `
  SELECT
    aki_hex AS akiHex,
    der_base64 AS derBase64,
    issuer_key AS issuerKey,
    issuer_name AS issuerName,
    not_after AS notAfter,
    not_before AS notBefore,
    serial_number_hex AS serialNumberHex,
    ski_hex AS skiHex,
    source_country_code AS sourceCountryCode,
    source_dn AS sourceDn,
    subject_key AS subjectKey,
    subject_name AS subjectName
  FROM trust_store_dscs
  WHERE ski_hex = ?
`;

let pkijsConfigured = false;
let trustBundleLoader: PkdTrustBundleLoader | null = null;
let configuredTrustStoreDatabase: PkdTrustD1Database | null = null;
let configuredR2Bucket: PkdTrustR2Bucket | null = null;
let configuredInlineTrustBundleJson: string | null = null;
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

function resolveStringEnvValue(env: unknown, key: string): string | null {
  if (!(env && typeof env === "object")) {
    return null;
  }

  const candidate = Reflect.get(env, key);
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
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

function getTrustStoreDatabase(env: unknown): PkdTrustD1Database | null {
  if (!env || typeof env !== "object") {
    return null;
  }

  const candidate = Reflect.get(env, "TRUST_STORE");

  return candidate &&
    typeof candidate === "object" &&
    typeof Reflect.get(candidate, "prepare") === "function"
    ? (candidate as PkdTrustD1Database)
    : null;
}

function parseTextJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function objectMapToStringArrayIndex(
  value: Record<string, string[]> | null | undefined
): Map<string, string[]> {
  const index = new Map<string, string[]>();

  if (!value) {
    return index;
  }

  for (const [key, entries] of Object.entries(value)) {
    if (!(key && Array.isArray(entries))) {
      continue;
    }

    index.set(
      key.toLowerCase(),
      Array.from(new Set(entries.filter((entry) => typeof entry === "string")))
    );
  }

  return index;
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
  const hydrated = hydratePkdTrustBundle(parsed, {
    dscSegmentLoader: (segmentKey) =>
      loadTrustBundleDscSegmentFromR2Bucket(bucket, segmentKey),
  });

  trustBundleCache = {
    bundle: hydrated,
    etag: object.httpEtag,
    expiresAt: Date.now() + PKD_TRUST_BUNDLE_CACHE_TTL_MS,
  };

  return hydrated;
}

async function loadTrustBundleDscSegmentFromR2Bucket(
  bucket: PkdTrustR2Bucket,
  segmentKey: string
): Promise<PkdTrustBundleDscSegment | null> {
  const object = await bucket.get(pkdTrustBundleDscSegmentKey(segmentKey));

  if (!object) {
    return null;
  }

  const bytes = new Uint8Array(await object.arrayBuffer());
  return hydratePkdTrustBundleDscSegment(parseTextJson(bytes));
}

async function queryFirstRow<T>(
  database: PkdTrustD1Database,
  query: string,
  ...values: unknown[]
): Promise<T | null> {
  return database.prepare(query).bind(...values).first<T>();
}

async function queryRows<T>(
  database: PkdTrustD1Database,
  query: string,
  ...values: unknown[]
): Promise<T[]> {
  const result = await database.prepare(query).bind(...values).all<T>();
  return result.results ?? [];
}

function parseMasterListSourcesJson(value: string): PkdTrustBundleSource[] {
  const parsed = JSON.parse(value) as unknown;

  return Array.isArray(parsed)
    ? parsed.filter(
        (entry): entry is PkdTrustBundleSource =>
          Boolean(
            entry &&
              typeof entry === "object" &&
              typeof Reflect.get(entry, "dn") === "string" &&
              (Reflect.get(entry, "countryCode") === null ||
                typeof Reflect.get(entry, "countryCode") === "string")
          )
      )
    : [];
}

function mapTrustStoreCscaRow(row: TrustStoreCscaRow): PkdCscaRecord {
  return {
    akiHex: row.akiHex,
    derBase64: row.derBase64,
    issuerKey: row.issuerKey,
    issuerName: row.issuerName,
    masterListSources: parseMasterListSourcesJson(row.masterListSourcesJson),
    notAfter: row.notAfter,
    notBefore: row.notBefore,
    serialNumberHex: row.serialNumberHex,
    skiHex: row.skiHex,
    sourceCountryCode: row.sourceCountryCode,
    sourceDn: row.sourceDn,
    subjectKey: row.subjectKey,
    subjectName: row.subjectName,
  };
}

function mapTrustStoreDscRow(row: PkdCertificateRecord): PkdCertificateRecord {
  return {
    akiHex: row.akiHex,
    derBase64: row.derBase64,
    issuerKey: row.issuerKey,
    issuerName: row.issuerName,
    notAfter: row.notAfter,
    notBefore: row.notBefore,
    serialNumberHex: row.serialNumberHex,
    skiHex: row.skiHex,
    sourceCountryCode: row.sourceCountryCode,
    sourceDn: row.sourceDn,
    subjectKey: row.subjectKey,
    subjectName: row.subjectName,
  };
}

async function loadTrustBundleFromD1Database(
  database: PkdTrustD1Database
): Promise<PkdTrustBundle | null> {
  if (trustBundleCache.bundle && !pkdTrustBundleCacheExpired()) {
    return trustBundleCache.bundle;
  }

  const metadata = await queryFirstRow<TrustStoreMetadataRow>(
    database,
    SELECT_TRUST_STORE_METADATA_SQL,
    TRUST_STORE_METADATA_ID
  );

  if (!metadata) {
    clearPkdTrustBundleCache();
    return null;
  }

  const [cscaRows, crlRows, crlRevocationRows] = await Promise.all([
    queryRows<TrustStoreCscaRow>(database, SELECT_TRUST_STORE_CSCAS_SQL),
    queryRows<TrustStoreCrlRow>(database, SELECT_TRUST_STORE_CRLS_SQL),
    queryRows<TrustStoreCrlRevocationRow>(
      database,
      SELECT_TRUST_STORE_CRL_REVOCATIONS_SQL
    ),
  ]);
  const revokedSerialsByCrlId = new Map<string, string[]>();

  for (const row of crlRevocationRows) {
    addIndexedValue(
      revokedSerialsByCrlId,
      String(row.crlId),
      row.revokedSerialNumberHex
    );
  }

  const raw: PkdTrustBundleJson = {
    counts: {
      cscas: metadata.cscaCount,
      crls: metadata.crlCount,
      dscs: metadata.dscCount,
      ignoredBcsc: metadata.ignoredBcsc,
      ignoredBcscNc: metadata.ignoredBcscNc,
    },
    cscas: cscaRows.map(mapTrustStoreCscaRow),
    crls: crlRows.map((row) => ({
      akiHex: row.akiHex,
      derBase64: row.derBase64,
      issuerKey: row.issuerKey,
      issuerName: row.issuerName,
      nextUpdate: row.nextUpdate,
      revokedSerialNumbersHex:
        revokedSerialsByCrlId.get(String(row.id))?.map((value) => value) ?? [],
      sourceCountryCode: row.sourceCountryCode,
      sourceDn: row.sourceDn,
      thisUpdate: row.thisUpdate,
    })),
    dscs: [],
    generatedAt: metadata.generatedAt,
    sources: {
      masterListsLdif: {
        path: metadata.masterListsLdifPath,
        version: metadata.masterListsLdifVersion,
      },
      objectLdif: {
        path: metadata.objectLdifPath,
        version: metadata.objectLdifVersion,
      },
    },
    version: metadata.version as typeof PKD_TRUST_BUNDLE_VERSION,
  };
  const hydrated = hydratePkdTrustBundle(raw, {
    dscRecordLoaderByIssuerSerial: async (issuerKey, serialNumberHex) => {
      const row = await queryFirstRow<PkdCertificateRecord>(
        database,
        SELECT_TRUST_STORE_DSC_BY_ISSUER_SERIAL_SQL,
        issuerKey,
        serialNumberHex.toLowerCase()
      );

      return row ? mapTrustStoreDscRow(row) : null;
    },
    dscRecordsLoaderBySkiHex: async (skiHex) =>
      (
        await queryRows<PkdCertificateRecord>(
          database,
          SELECT_TRUST_STORE_DSCS_BY_SKI_SQL,
          skiHex.toLowerCase()
        )
      ).map(mapTrustStoreDscRow),
  });

  trustBundleCache = {
    bundle: hydrated,
    etag: null,
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
  configuredTrustStoreDatabase = null;
  configuredR2Bucket = null;
  configuredInlineTrustBundleJson = null;
  trustBundleLoader = loader;
  clearPkdTrustBundleCache();
}

export function configurePkdTrustBundleLoaderFromEnv(env: unknown): void {
  const inlineTrustBundleJson = resolveStringEnvValue(
    env,
    INLINE_PKD_TRUST_BUNDLE_ENV_KEY
  );

  if (inlineTrustBundleJson) {
    if (
      configuredInlineTrustBundleJson === inlineTrustBundleJson &&
      trustBundleLoader
    ) {
      return;
    }

    configuredR2Bucket = null;
    configuredTrustStoreDatabase = null;
    configuredInlineTrustBundleJson = inlineTrustBundleJson;
    trustBundleLoader = async () =>
      hydratePkdTrustBundle(JSON.parse(inlineTrustBundleJson));
    clearPkdTrustBundleCache();
    return;
  }

  const trustStoreDatabase = getTrustStoreDatabase(env);

  if (trustStoreDatabase) {
    if (
      configuredTrustStoreDatabase === trustStoreDatabase &&
      trustBundleLoader
    ) {
      return;
    }

    configuredTrustStoreDatabase = trustStoreDatabase;
    configuredR2Bucket = null;
    configuredInlineTrustBundleJson = null;
    trustBundleLoader = () => loadTrustBundleFromD1Database(trustStoreDatabase);
    clearPkdTrustBundleCache();
    return;
  }

  const bucket = getR2Bucket(env);

  if (!bucket) {
    if (
      !(
        configuredTrustStoreDatabase ||
        configuredR2Bucket ||
        configuredInlineTrustBundleJson ||
        trustBundleLoader
      )
    ) {
      return;
    }

    configurePkdTrustBundleLoader(null);
    return;
  }

  if (configuredR2Bucket === bucket && trustBundleLoader) {
    return;
  }

  configuredTrustStoreDatabase = null;
  configuredR2Bucket = bucket;
  configuredInlineTrustBundleJson = null;
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

export function parsePkdTrustBundleDscSegmentJson(
  value: unknown
): PkdTrustBundleDscSegmentJson {
  if (!value || typeof value !== "object") {
    throw new Error("pkd_trust_bundle_dsc_segment_invalid");
  }

  const segment = value as PkdTrustBundleDscSegmentJson;

  if (
    segment.version !== PKD_TRUST_BUNDLE_VERSION ||
    !Array.isArray(segment.dscs) ||
    typeof segment.segmentKey !== "string" ||
    segment.segmentKey.length === 0
  ) {
    throw new Error("pkd_trust_bundle_dsc_segment_invalid");
  }

  return segment;
}

export function hydratePkdTrustBundleDscSegment(
  value: unknown
): PkdTrustBundleDscSegment {
  const raw = parsePkdTrustBundleDscSegmentJson(value);
  const dscRecordsByIssuerSerial = new Map<string, PkdCertificateRecord>();
  const dscRecordsBySkiHex = new Map<string, PkdCertificateRecord[]>();

  for (const record of raw.dscs) {
    dscRecordsByIssuerSerial.set(
      dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
      record
    );
    addIndexedValue(dscRecordsBySkiHex, record.skiHex, record);
  }

  return {
    dscRecordsByIssuerSerial,
    dscRecordsBySkiHex,
    dscsByIssuerSerial: new Map<string, PkdTrustBundleCertificate>(),
    dscsBySkiHex: new Map<string, PkdTrustBundleCertificate[]>(),
    raw,
  };
}

export function hydratePkdTrustBundle(
  value: unknown,
  options?: {
    dscRecordLoaderByIssuerSerial?:
      | PkdTrustBundleDscRecordByIssuerSerialLoader
      | null;
    dscRecordsLoaderBySkiHex?: PkdTrustBundleDscRecordsBySkiLoader | null;
    dscSegmentLoader?: PkdTrustBundleDscSegmentLoader | null;
  }
): PkdTrustBundle {
  const raw = parsePkdTrustBundleJson(value);
  const cscas: PkdTrustBundleCertificate[] = [];
  const crls: PkdTrustBundleCrl[] = [];
  const cscasBySubjectKey = new Map<string, PkdTrustBundleCertificate[]>();
  const cscasBySkiHex = new Map<string, PkdTrustBundleCertificate[]>();
  const crlsByAkiHex = new Map<string, PkdTrustBundleCrl[]>();
  const crlsByIssuerKey = new Map<string, PkdTrustBundleCrl[]>();
  const dscRecordsByIssuerSerial = new Map<string, PkdCertificateRecord>();
  const dscRecordsBySkiHex = new Map<string, PkdCertificateRecord[]>();
  const dscSegmentKeysByIssuerSerial = objectMapToStringArrayIndex(
    raw.dscSegmentIndex?.issuerSerial
  );
  const dscSegmentKeysBySkiHex = objectMapToStringArrayIndex(
    raw.dscSegmentIndex?.skiHex
  );

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
    dscSegmentKeysByIssuerSerial,
    dscSegmentKeysBySkiHex,
    dscSegments: new Map<string, PkdTrustBundleDscSegment>(),
    dscRecordLoaderByIssuerSerial:
      options?.dscRecordLoaderByIssuerSerial ?? null,
    dscRecordsLoaderBySkiHex: options?.dscRecordsLoaderBySkiHex ?? null,
    dscSegmentLoader: options?.dscSegmentLoader ?? null,
    dscsByIssuerSerial: new Map<string, PkdTrustBundleCertificate>(),
    dscsBySkiHex: new Map<string, PkdTrustBundleCertificate[]>(),
    raw,
  };
}

async function loadPkdTrustBundleDscSegment(
  bundle: PkdTrustBundle,
  segmentKey: string
): Promise<PkdTrustBundleDscSegment | null> {
  const normalizedSegmentKey = segmentKey.toUpperCase();
  const cached = bundle.dscSegments.get(normalizedSegmentKey);

  if (cached) {
    return cached;
  }

  if (!bundle.dscSegmentLoader) {
    return null;
  }

  const loaded = await bundle.dscSegmentLoader(normalizedSegmentKey);

  if (!loaded) {
    return null;
  }

  bundle.dscSegments.set(normalizedSegmentKey, loaded);
  return loaded;
}

function resolveInlinePkdDscCertificate(
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

function resolveInlinePkdDscCertificatesBySki(
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

function resolveSegmentPkdDscCertificate(
  segment: PkdTrustBundleDscSegment,
  issuerKey: string,
  serialNumberHex: string
): PkdTrustBundleCertificate | null {
  const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
  const cached = segment.dscsByIssuerSerial.get(key);

  if (cached) {
    return cached;
  }

  const record = segment.dscRecordsByIssuerSerial.get(key);

  if (!record) {
    return null;
  }

  const entry = {
    cert: parseDerCertificate(decodeBase64(record.derBase64)),
    record,
  };
  segment.dscsByIssuerSerial.set(key, entry);
  return entry;
}

function resolveSegmentPkdDscCertificatesBySki(
  segment: PkdTrustBundleDscSegment,
  skiHex: string
): PkdTrustBundleCertificate[] {
  const normalizedSkiHex = skiHex.toLowerCase();
  const cached = segment.dscsBySkiHex.get(normalizedSkiHex);

  if (cached) {
    return [...cached];
  }

  const records = segment.dscRecordsBySkiHex.get(normalizedSkiHex) ?? [];
  const entries = records.map((record) => ({
    cert: parseDerCertificate(decodeBase64(record.derBase64)),
    record,
  }));

  segment.dscsBySkiHex.set(normalizedSkiHex, entries);
  return [...entries];
}

export async function resolvePkdDscCertificate(
  bundle: PkdTrustBundle,
  issuerKey: string,
  serialNumberHex: string
): Promise<PkdTrustBundleCertificate | null> {
  const inlineEntry = resolveInlinePkdDscCertificate(
    bundle,
    issuerKey,
    serialNumberHex
  );

  if (inlineEntry) {
    return inlineEntry;
  }

  const key = dscIssuerSerialKey(issuerKey, serialNumberHex);
  const segmentKeys = bundle.dscSegmentKeysByIssuerSerial.get(key) ?? [];

  for (const segmentKey of segmentKeys) {
    const segment = await loadPkdTrustBundleDscSegment(bundle, segmentKey);

    if (!segment) {
      continue;
    }

    const entry = resolveSegmentPkdDscCertificate(
      segment,
      issuerKey,
      serialNumberHex
    );

    if (entry) {
      return entry;
    }
  }

  if (bundle.dscRecordLoaderByIssuerSerial) {
    const record = await bundle.dscRecordLoaderByIssuerSerial(
      issuerKey,
      serialNumberHex
    );

    if (record) {
      bundle.dscRecordsByIssuerSerial.set(
        dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
        record
      );
      addIndexedValue(bundle.dscRecordsBySkiHex, record.skiHex, record);

      return resolveInlinePkdDscCertificate(
        bundle,
        record.issuerKey,
        record.serialNumberHex
      );
    }
  }

  return null;
}

export async function resolvePkdDscCertificatesBySki(
  bundle: PkdTrustBundle,
  skiHex: string
): Promise<PkdTrustBundleCertificate[]> {
  const deduped = new Map<string, PkdTrustBundleCertificate>();

  for (const entry of resolveInlinePkdDscCertificatesBySki(bundle, skiHex)) {
    deduped.set(entry.record.derBase64, entry);
  }

  const segmentKeys = bundle.dscSegmentKeysBySkiHex.get(skiHex.toLowerCase()) ?? [];

  for (const segmentKey of segmentKeys) {
    const segment = await loadPkdTrustBundleDscSegment(bundle, segmentKey);

    if (!segment) {
      continue;
    }

    for (const entry of resolveSegmentPkdDscCertificatesBySki(segment, skiHex)) {
      deduped.set(entry.record.derBase64, entry);
    }
  }

  if (bundle.dscRecordsLoaderBySkiHex) {
    for (const record of await bundle.dscRecordsLoaderBySkiHex(skiHex)) {
      bundle.dscRecordsByIssuerSerial.set(
        dscIssuerSerialKey(record.issuerKey, record.serialNumberHex),
        record
      );
      addIndexedValue(bundle.dscRecordsBySkiHex, record.skiHex, record);
    }

    for (const entry of resolveInlinePkdDscCertificatesBySki(bundle, skiHex)) {
      deduped.set(entry.record.derBase64, entry);
    }
  }

  return [...deduped.values()];
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

export function pkdTrustBundleDscSegmentKey(segmentKey: string): string {
  return `${PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX}/${segmentKey.toUpperCase()}.json`;
}

export function pkdTrustBundleVersion(): typeof PKD_TRUST_BUNDLE_VERSION {
  return PKD_TRUST_BUNDLE_VERSION;
}
