import {
  type AsnType,
  fromBER,
  Integer,
  ObjectIdentifier,
  OctetString,
  Sequence,
} from "asn1js";
import {
  AlgorithmIdentifier,
  Certificate,
  ContentInfo,
  createECDSASignatureFromCMS,
  ECNamedCurves,
  getHashAlgorithm,
  IssuerAndSerialNumber,
  RSASSAPSSParams,
  SignedData,
  type SignerInfo,
} from "pkijs";
import {
  authorityKeyIdentifierHex,
  ensurePkijsEngine,
  exactBytes,
  hexBytes,
  loadPkdTrustBundle,
  type PkdTrustBundle,
  type PkdTrustBundleCertificate,
  type PkdTrustBundleCrl,
  relativeDistinguishedNameKey,
  resolvePkdDscCertificate,
  resolvePkdDscCertificatesBySki,
  subjectKeyIdentifierHex,
  subjectKeyIdentifierHexOrKeyHash,
} from "./pkd-trust";
import { readTlv } from "./tlv";
import type {
  AuthenticityValidationResult,
  PassiveAuthCrlStatus,
  PassiveAuthFailureReason,
  PassiveAuthSignerSource,
  SupportedHashAlgorithm,
} from "./validation-types";

const ICAO_LDS_SECURITY_OBJECT_OID = "2.23.136.1.1.1";
const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const SOD_ROOT_TAG = 0x77;
const SHA_1_OID = "1.3.14.3.2.26";
const SHA_256_OID = "2.16.840.1.101.3.4.2.1";
const SHA_384_OID = "2.16.840.1.101.3.4.2.2";
const SHA_512_OID = "2.16.840.1.101.3.4.2.3";
const CONTENT_TYPE_ATTRIBUTE_OID = "1.2.840.113549.1.9.3";
const MESSAGE_DIGEST_ATTRIBUTE_OID = "1.2.840.113549.1.9.4";
const ECDSA_PUBLIC_KEY_OID = "1.2.840.10045.2.1";
const EC_PRIME_FIELD_OID = "1.2.840.10045.1.1";
const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
const RSA_PSS_OID = "1.2.840.113549.1.1.10";
const OID_PATTERN = /^\d+(?:\.\d+)+$/;
const SUPPORTED_NAMED_CURVES = ["P-256", "P-384", "P-521"] as const;
const EXPLICIT_EC_CURVES = [
  {
    aHex: "ffffffff00000001000000000000000000000000fffffffffffffffffffffffc",
    bHex: "5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b",
    cofactorHex: "01",
    fieldTypeOid: EC_PRIME_FIELD_OID,
    generatorHex:
      "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
    name: "P-256",
    namedCurveOid: "1.2.840.10045.3.1.7",
    orderHex:
      "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
    primeHex:
      "ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
  },
  {
    aHex: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc",
    bHex: "b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef",
    cofactorHex: "01",
    fieldTypeOid: EC_PRIME_FIELD_OID,
    generatorHex:
      "04aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab73617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f",
    name: "P-384",
    namedCurveOid: "1.3.132.0.34",
    orderHex:
      "ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973",
    primeHex:
      "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff",
  },
  {
    aHex: "01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc",
    bHex: "0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00",
    cofactorHex: "01",
    fieldTypeOid: EC_PRIME_FIELD_OID,
    generatorHex:
      "0400c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650",
    name: "P-521",
    namedCurveOid: "1.3.132.0.35",
    orderHex:
      "01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409",
    primeHex:
      "01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  },
] as const;

type ParsedSodSecurityObject = {
  algorithm: SupportedHashAlgorithm;
  dg1Hash: Uint8Array;
  dg2Hash: Uint8Array;
  signedData: SignedData;
};

type ResolvedSignerCertificate = {
  cert: Certificate;
  signerSource: PassiveAuthSignerSource;
};

type CrlVerificationState = "current_verified" | "stale_verified";

type SignerIssuerMatchResult =
  | {
      issuer: PkdTrustBundleCertificate;
      ok: true;
    }
  | {
      detail?: string | null;
      ok: false;
      reason: Extract<
        PassiveAuthFailureReason,
        "chain_untrusted" | "signer_certificate_invalid"
      >;
    };

type CmsSignatureVerificationResult = {
  detail: string | null;
  ok: boolean;
};

type ExplicitEcCurveParameters = {
  aHex: string;
  bHex: string;
  cofactorHex: string | null;
  fieldTypeOid: string;
  generatorHex: string;
  orderHex: string;
  primeHex: string;
};

function bufferBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return combined;
}

function asn1Buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function subtleAlgorithmFromOid(oid: string): SupportedHashAlgorithm | null {
  switch (oid) {
    case SHA_1_OID:
      return "SHA-1";
    case SHA_256_OID:
      return "SHA-256";
    case SHA_384_OID:
      return "SHA-384";
    case SHA_512_OID:
      return "SHA-512";
    default:
      return null;
  }
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

  return concatUint8Arrays(parts);
}

function parseBer(bytes: Uint8Array, errorCode: string): unknown {
  const decoded = fromBER(asn1Buffer(bytes));

  if (decoded.offset === -1) {
    throw new Error(errorCode);
  }

  return decoded.result;
}

function parseContentInfo(sod: Uint8Array): ContentInfo {
  const schema = parseBer(unwrapSodContentInfoBytes(sod), "sod_parse_failed");

  try {
    return new ContentInfo({
      schema,
    });
  } catch {
    throw new Error("sod_parse_failed");
  }
}

function unwrapSodContentInfoBytes(sod: Uint8Array): Uint8Array {
  try {
    const root = readTlv(sod, 0);

    if (root.tag === SOD_ROOT_TAG && root.nextOffset === sod.length) {
      return root.value;
    }
  } catch {
    return sod;
  }

  return sod;
}

function parseSignedData(contentInfo: ContentInfo): SignedData {
  if (contentInfo.contentType !== CMS_SIGNED_DATA_OID) {
    throw new Error("sod_content_type_invalid");
  }

  try {
    return new SignedData({
      schema: contentInfo.content,
    });
  } catch {
    throw new Error("sod_parse_failed");
  }
}

function parseLdsSecurityObjectRoot(signedData: SignedData): Sequence {
  if (
    signedData.encapContentInfo.eContentType !== ICAO_LDS_SECURITY_OBJECT_OID
  ) {
    throw new Error("lds_security_object_missing");
  }

  const eContent = signedData.encapContentInfo.eContent;

  if (!eContent) {
    throw new Error("lds_security_object_missing");
  }

  const result = parseBer(
    octetStringBytes(eContent),
    "lds_security_object_parse_failed"
  );

  if (!(result instanceof Sequence)) {
    throw new Error("lds_security_object_invalid");
  }

  return result;
}

function parseLdsSecurityObjectNodes(root: Sequence): {
  hashAlgorithmNode: Sequence;
  hashValuesNode: Sequence;
} {
  const [versionNode, hashAlgorithmNode, hashValuesNode] =
    root.valueBlock.value;

  if (
    !(
      versionNode instanceof Integer &&
      hashAlgorithmNode instanceof Sequence &&
      hashValuesNode instanceof Sequence
    )
  ) {
    throw new Error("lds_security_object_invalid");
  }

  return {
    hashAlgorithmNode,
    hashValuesNode,
  };
}

function parseDigestAlgorithm(
  hashAlgorithmNode: Sequence
): SupportedHashAlgorithm {
  const hashAlgorithm = new AlgorithmIdentifier({
    schema: hashAlgorithmNode,
  });
  const algorithm = subtleAlgorithmFromOid(hashAlgorithm.algorithmId);

  if (!algorithm) {
    throw new Error("unsupported_digest_algorithm");
  }

  return algorithm;
}

function parseDgHashEntry(child: unknown): {
  dataGroupNumber: number;
  digest: Uint8Array;
} {
  if (!(child instanceof Sequence) || child.valueBlock.value.length < 2) {
    throw new Error("dg_hash_entry_invalid");
  }

  const [dataGroupNumberNode, dataGroupHashNode] = child.valueBlock.value;

  if (
    !(
      dataGroupNumberNode instanceof Integer &&
      dataGroupHashNode instanceof OctetString
    )
  ) {
    throw new Error("dg_hash_entry_invalid");
  }

  return {
    dataGroupNumber: dataGroupNumberNode.valueBlock.valueDec,
    digest: octetStringBytes(dataGroupHashNode),
  };
}

function parseRequiredDgHashes(hashValuesNode: Sequence): {
  dg1Hash: Uint8Array;
  dg2Hash: Uint8Array;
} {
  let dg1Hash: Uint8Array | null = null;
  let dg2Hash: Uint8Array | null = null;

  for (const child of hashValuesNode.valueBlock.value) {
    const { dataGroupNumber, digest } = parseDgHashEntry(child);

    if (dataGroupNumber === 1) {
      dg1Hash = digest;
      continue;
    }

    if (dataGroupNumber === 2) {
      dg2Hash = digest;
    }
  }

  if (!(dg1Hash && dg2Hash)) {
    throw new Error("required_dg_hash_missing");
  }

  return {
    dg1Hash,
    dg2Hash,
  };
}

function parseSodSecurityObject(sod: Uint8Array): ParsedSodSecurityObject {
  ensurePkijsEngine();
  const contentInfo = parseContentInfo(sod);
  const signedData = parseSignedData(contentInfo);
  const root = parseLdsSecurityObjectRoot(signedData);
  const { hashAlgorithmNode, hashValuesNode } =
    parseLdsSecurityObjectNodes(root);
  const algorithm = parseDigestAlgorithm(hashAlgorithmNode);
  const { dg1Hash, dg2Hash } = parseRequiredDgHashes(hashValuesNode);

  return {
    algorithm,
    dg1Hash,
    dg2Hash,
    signedData,
  };
}

async function createDigest(
  algorithm: SupportedHashAlgorithm,
  data: Uint8Array
): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest(algorithm, bufferBytes(data))
  );
}

function signerInfosOrThrow(signedData: SignedData): SignedData["signerInfos"] {
  if (signedData.signerInfos.length === 0) {
    throw new Error("missing_signer");
  }

  return signedData.signerInfos;
}

function signerInfoOrThrow(
  signedData: SignedData
): SignedData["signerInfos"][number] {
  const [signerInfo] = signerInfosOrThrow(signedData);

  if (!signerInfo) {
    throw new Error("missing_signer");
  }

  return signerInfo;
}

function issuerAndSerialFromSignerInfo(
  signerInfo: SignedData["signerInfos"][number]
): {
  issuerKey: string;
  serialNumberHex: string;
} | null {
  if (!(signerInfo.sid instanceof IssuerAndSerialNumber)) {
    return null;
  }

  return {
    issuerKey: relativeDistinguishedNameKey(signerInfo.sid.issuer),
    serialNumberHex: hexBytes(
      new Uint8Array(signerInfo.sid.serialNumber.valueBlock.valueHex)
    ),
  };
}

function subjectKeyIdentifierFromSignerInfo(
  signerInfo: SignedData["signerInfos"][number]
): string | null {
  if (signerInfo.sid instanceof OctetString) {
    return hexBytes(octetStringBytes(signerInfo.sid));
  }

  const contextSpecificSid = signerInfo.sid as {
    idBlock?: {
      tagClass?: number;
      tagNumber?: number;
    };
    valueBlock?: {
      value?: unknown[];
      valueHex?: ArrayBuffer;
      valueHexView?: Uint8Array;
    };
  };

  if (
    contextSpecificSid.idBlock?.tagClass !== 3 ||
    contextSpecificSid.idBlock?.tagNumber !== 0
  ) {
    return null;
  }

  const [nestedValue] = contextSpecificSid.valueBlock?.value ?? [];

  if (nestedValue instanceof OctetString) {
    return hexBytes(octetStringBytes(nestedValue));
  }

  if (contextSpecificSid.valueBlock?.valueHexView) {
    return hexBytes(exactBytes(contextSpecificSid.valueBlock.valueHexView));
  }

  if (contextSpecificSid.valueBlock?.valueHex) {
    return hexBytes(new Uint8Array(contextSpecificSid.valueBlock.valueHex));
  }

  return null;
}

function embeddedCertificates(signedData: SignedData): Certificate[] {
  return (
    signedData.certificates?.filter(
      (entry): entry is Certificate => entry instanceof Certificate
    ) ?? []
  );
}

async function certificateMatchesSigner(
  cert: Certificate,
  signerInfo: SignedData["signerInfos"][number]
): Promise<boolean> {
  if (signerInfo.sid instanceof IssuerAndSerialNumber) {
    const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);

    return (
      signerIdentifier !== null &&
      relativeDistinguishedNameKey(cert.issuer) ===
        signerIdentifier.issuerKey &&
      hexBytes(new Uint8Array(cert.serialNumber.valueBlock.valueHex)) ===
        signerIdentifier.serialNumberHex
    );
  }

  const signerSkiHex = subjectKeyIdentifierFromSignerInfo(signerInfo);

  if (!signerSkiHex) {
    return false;
  }

  const certSkiHex = await subjectKeyIdentifierHex(cert);

  return certSkiHex === signerSkiHex;
}

function certificateIssuerSerialKey(cert: Certificate): string {
  return `${relativeDistinguishedNameKey(cert.issuer)}:${hexBytes(
    new Uint8Array(cert.serialNumber.valueBlock.valueHex)
  )}`;
}

function dedupeResolvedSignerCertificates(
  candidates: ResolvedSignerCertificate[]
): ResolvedSignerCertificate[] {
  const deduped = new Map<string, ResolvedSignerCertificate>();

  for (const candidate of candidates) {
    const key = `${candidate.signerSource}:${certificateIssuerSerialKey(
      candidate.cert
    )}`;

    if (!deduped.has(key)) {
      deduped.set(key, candidate);
    }
  }

  return [...deduped.values()];
}

async function resolveSignerCertificates({
  bundle,
  signedData,
  signerInfo,
}: {
  bundle: PkdTrustBundle | null;
  signedData: SignedData;
  signerInfo: SignedData["signerInfos"][number];
}): Promise<ResolvedSignerCertificate[]> {
  const candidates: ResolvedSignerCertificate[] = [];

  for (const cert of embeddedCertificates(signedData)) {
    if (await certificateMatchesSigner(cert, signerInfo)) {
      candidates.push({
        cert,
        signerSource: "sod",
      });
    }
  }

  if (!bundle) {
    return candidates;
  }

  const signerIdentifier = issuerAndSerialFromSignerInfo(signerInfo);
  const subjectKeyIdentifier = subjectKeyIdentifierFromSignerInfo(signerInfo);

  if (signerIdentifier) {
    const dsc = await resolvePkdDscCertificate(
      bundle,
      signerIdentifier.issuerKey,
      signerIdentifier.serialNumberHex
    );

    if (dsc) {
      candidates.push({
        cert: dsc.cert,
        signerSource: "bundle",
      });
    }
  }

  if (subjectKeyIdentifier) {
    for (const dsc of await resolvePkdDscCertificatesBySki(
      bundle,
      subjectKeyIdentifier
    )) {
      candidates.push({
        cert: dsc.cert,
        signerSource: "bundle",
      });
    }
  }

  return dedupeResolvedSignerCertificates(candidates);
}

function signerValidityFailureReason(
  signerCert: Certificate,
  checkDate: Date
): Extract<
  PassiveAuthFailureReason,
  "signer_certificate_expired" | "signer_certificate_not_yet_valid"
> | null {
  if (checkDate < signerCert.notBefore.value) {
    return "signer_certificate_not_yet_valid";
  }

  if (checkDate > signerCert.notAfter.value) {
    return "signer_certificate_expired";
  }

  return null;
}

function signedDataCertificatesWithSigner(
  signedData: SignedData,
  signerCert: Certificate
): SignedData["certificates"] {
  const signerSubjectKey = relativeDistinguishedNameKey(signerCert.subject);
  const signerSerialNumberHex = hexBytes(
    new Uint8Array(signerCert.serialNumber.valueBlock.valueHex)
  );
  const certificates = [...(signedData.certificates ?? [])];

  for (const entry of certificates) {
    if (
      entry instanceof Certificate &&
      relativeDistinguishedNameKey(entry.subject) === signerSubjectKey &&
      hexBytes(new Uint8Array(entry.serialNumber.valueBlock.valueHex)) ===
        signerSerialNumberHex
    ) {
      return certificates;
    }
  }

  return [...certificates, signerCert];
}

function encodeCmsDiagnosticValue(
  value: string | number | boolean | null
): string {
  if (value === null) {
    return "null";
  }

  return String(value).replaceAll("|", "/");
}

function cmsDiagnosticString(
  fields: Record<string, string | number | boolean | null>
): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${encodeCmsDiagnosticValue(value)}`)
    .join("|");
}

function signerInfoDiagnostics(
  signerInfo: SignerInfo,
  signerCert: Certificate
): Record<string, string | number | boolean | null> {
  return {
    digest_algorithm: signerInfo.digestAlgorithm.algorithmId,
    public_key_algorithm: signerCert.subjectPublicKeyInfo.algorithm.algorithmId,
    signature_algorithm: signerInfo.signatureAlgorithm.algorithmId,
    signed_attrs: Boolean(signerInfo.signedAttrs),
    signed_attrs_length:
      signerInfo.signedAttrs?.encodedValue.byteLength ?? null,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function pkijsVerificationDetail(
  signerInfo: SignerInfo,
  signerCert: Certificate,
  result: {
    code?: number;
    message?: string;
    signatureVerified?: boolean | null;
  }
): string {
  return cmsDiagnosticString({
    path: "pkijs",
    ...signerInfoDiagnostics(signerInfo, signerCert),
    pkijs_code: result.code ?? null,
    pkijs_message: result.message ?? null,
    pkijs_signature_verified: result.signatureVerified ?? null,
  });
}

function manualVerificationDetail(
  signerInfo: SignerInfo,
  signerCert: Certificate,
  outcome: {
    error?: unknown;
    verified?: boolean;
  }
): string {
  return cmsDiagnosticString({
    path: "manual",
    ...signerInfoDiagnostics(signerInfo, signerCert),
    manual_error: outcome.error ? errorMessage(outcome.error) : null,
    manual_verified: outcome.verified ?? null,
  });
}

async function cmsPkijsFallbackResult({
  checkDate,
  manualOutcome,
  signedData,
  signerCert,
  signerInfo,
}: {
  checkDate: Date;
  manualOutcome: {
    error?: unknown;
    verified?: boolean;
  };
  signedData: SignedData;
  signerCert: Certificate;
  signerInfo: SignerInfo;
}): Promise<CmsSignatureVerificationResult> {
  const pkijsResult = await verifyCmsSignatureWithPkijs({
    checkDate,
    signedData,
    signerCert,
  });

  return {
    detail: cmsDiagnosticString({
      fallback: "pkijs",
      manual_detail: manualVerificationDetail(
        signerInfo,
        signerCert,
        manualOutcome
      ),
      pkijs_detail: pkijsResult.detail,
    }),
    ok: pkijsResult.ok,
  };
}

async function verifyCmsSignatureWithPkijs({
  checkDate,
  signedData,
  signerCert,
}: {
  checkDate: Date;
  signedData: SignedData;
  signerCert: Certificate;
}): Promise<CmsSignatureVerificationResult> {
  const signerInfo = signerInfoOrThrow(signedData);
  const originalCertificates = signedData.certificates;
  const normalizedSignerCert =
    normalizedEcCertificatePublicKeyAlgorithm(signerCert);
  signedData.certificates = signedDataCertificatesWithSigner(
    signedData,
    normalizedSignerCert
  );

  try {
    const result = await signedData.verify({
      checkChain: false,
      checkDate,
      extendedMode: true,
      signer: 0,
    });

    return {
      detail: pkijsVerificationDetail(signerInfo, signerCert, result),
      ok: result.signatureVerified === true,
    };
  } catch (error) {
    return {
      detail: pkijsVerificationDetail(signerInfo, signerCert, {
        message: errorMessage(error),
      }),
      ok: false,
    };
  } finally {
    signedData.certificates = originalCertificates;
  }
}

async function verifyCmsSignature({
  checkDate,
  signedData,
  signerCert,
}: {
  checkDate: Date;
  signedData: SignedData;
  signerCert: Certificate;
}): Promise<CmsSignatureVerificationResult> {
  const signerInfo = signerInfoOrThrow(signedData);

  if (signerInfo.signedAttrs) {
    try {
      const manualVerified = await verifyCmsSignatureManually({
        signedData,
        signerCert,
      });

      if (manualVerified) {
        return {
          detail: manualVerificationDetail(signerInfo, signerCert, {
            verified: true,
          }),
          ok: true,
        };
      }

      return cmsPkijsFallbackResult({
        checkDate,
        manualOutcome: {
          verified: false,
        },
        signedData,
        signerCert,
        signerInfo,
      });
    } catch (error) {
      return cmsPkijsFallbackResult({
        checkDate,
        manualOutcome: {
          error,
        },
        signedData,
        signerCert,
        signerInfo,
      });
    }
  }

  return verifyCmsSignatureWithPkijs({
    checkDate,
    signedData,
    signerCert,
  });
}

function parseSupportedHashAlgorithmName(
  algorithmName: string | null
): SupportedHashAlgorithm | null {
  switch (algorithmName) {
    case "SHA-1":
    case "SHA-256":
    case "SHA-384":
    case "SHA-512":
      return algorithmName;
    default:
      return null;
  }
}

function signerDigestAlgorithm(
  signerInfo: SignerInfo
): SupportedHashAlgorithm | null {
  return subtleAlgorithmFromOid(signerInfo.digestAlgorithm.algorithmId);
}

function signatureHashAlgorithm(
  signerInfo: SignerInfo
): SupportedHashAlgorithm | null {
  const algorithmFromSignature = parseSupportedHashAlgorithmName(
    getHashAlgorithm(signerInfo.signatureAlgorithm) || null
  );

  return algorithmFromSignature ?? signerDigestAlgorithm(signerInfo);
}

function algorithmIdentifierHashAlgorithm(
  signatureAlgorithm: AlgorithmIdentifier
): SupportedHashAlgorithm | null {
  return parseSupportedHashAlgorithmName(
    getHashAlgorithm(signatureAlgorithm) || null
  );
}

function encapsulatedContentBytes(signedData: SignedData): Uint8Array {
  const eContent = signedData.encapContentInfo.eContent;

  if (!eContent) {
    throw new Error("cms_content_missing");
  }

  if (eContent.idBlock.tagClass === 1 && eContent.idBlock.tagNumber === 4) {
    return exactBytes(new Uint8Array(eContent.getValue()));
  }

  return exactBytes(eContent.valueBlock.valueBeforeDecodeView);
}

function signedAttributeMessageDigest(
  signerInfo: SignerInfo
): Uint8Array | null {
  if (!signerInfo.signedAttrs) {
    return null;
  }

  let sawContentType = false;
  let messageDigest: Uint8Array | null = null;

  for (const attribute of signerInfo.signedAttrs.attributes) {
    if (attribute.type === CONTENT_TYPE_ATTRIBUTE_OID) {
      sawContentType = true;
      continue;
    }

    if (attribute.type !== MESSAGE_DIGEST_ATTRIBUTE_OID) {
      continue;
    }

    const [digestValue] = attribute.values;

    if (!(digestValue instanceof OctetString)) {
      throw new Error("cms_signed_attributes_invalid");
    }

    messageDigest = octetStringBytes(digestValue);
  }

  if (!(sawContentType && messageDigest)) {
    throw new Error("cms_signed_attributes_invalid");
  }

  return messageDigest;
}

function signedAttributesSignatureBytes(signerInfo: SignerInfo): Uint8Array {
  if (!signerInfo.signedAttrs) {
    throw new Error("cms_signed_attributes_invalid");
  }

  const signedAttributesBytes = exactBytes(
    new Uint8Array(signerInfo.signedAttrs.encodedValue)
  );

  if (signedAttributesBytes[0] === 0xa0) {
    signedAttributesBytes[0] = 0x31;
  }

  return signedAttributesBytes;
}

async function signedDataBytesForSignature({
  signedData,
  signerInfo,
}: {
  signedData: SignedData;
  signerInfo: SignerInfo;
}): Promise<Uint8Array> {
  if (!signerInfo.signedAttrs) {
    return encapsulatedContentBytes(signedData);
  }

  const digestAlgorithm = signerDigestAlgorithm(signerInfo);

  if (!digestAlgorithm) {
    throw new Error("cms_signature_digest_algorithm_invalid");
  }

  const expectedMessageDigest = signedAttributeMessageDigest(signerInfo);

  if (!expectedMessageDigest) {
    throw new Error("cms_signed_attributes_invalid");
  }

  const actualMessageDigest = await createDigest(
    digestAlgorithm,
    encapsulatedContentBytes(signedData)
  );

  if (!bytesEqual(actualMessageDigest, expectedMessageDigest)) {
    throw new Error("cms_signed_attributes_digest_mismatch");
  }

  return signedAttributesSignatureBytes(signerInfo);
}

function curveSizeBytes(namedCurve: string): number {
  const curve = ECNamedCurves.find(namedCurve);

  if (!curve) {
    throw new Error("cms_signature_curve_invalid");
  }

  return curve.size;
}

function ecdsaSignatureBytes({
  namedCurve,
  signatureBytes,
}: {
  namedCurve: string;
  signatureBytes: Uint8Array;
}): Uint8Array {
  const decoded = fromBER(bufferBytes(signatureBytes));

  if (decoded.offset === -1) {
    throw new Error("cms_signature_invalid_encoding");
  }

  return exactBytes(
    new Uint8Array(
      createECDSASignatureFromCMS(
        decoded.result as AsnType,
        curveSizeBytes(namedCurve)
      )
    )
  );
}

function oidString(value: string): string | null {
  return OID_PATTERN.test(value) ? value : null;
}

function integerHexValue(node: unknown): string | null {
  if (!(node instanceof Integer)) {
    return null;
  }

  const bytes = exactBytes(new Uint8Array(node.valueBlock.valueHexView));
  let offset = 0;

  while (offset < bytes.length - 1 && bytes[offset] === 0) {
    offset += 1;
  }

  return hexBytes(bytes.subarray(offset));
}

function octetStringHexValue(node: unknown): string | null {
  if (!(node instanceof OctetString)) {
    return null;
  }

  return hexBytes(exactBytes(new Uint8Array(node.valueBlock.valueHexView)));
}

function sequenceChildren(node: unknown): unknown[] {
  return node instanceof Sequence ? node.valueBlock.value : [];
}

function directObjectIdentifierValue(node: unknown): string | null {
  return node instanceof ObjectIdentifier
    ? oidString(node.valueBlock.toString())
    : null;
}

function explicitEcCurveParameters(
  algorithmParams: unknown
): ExplicitEcCurveParameters | null {
  if (!(algorithmParams instanceof Sequence)) {
    return null;
  }

  const [version, fieldIdentifier, curve, generator, order, cofactor] =
    sequenceChildren(algorithmParams);

  if (
    !(
      version instanceof Integer &&
      fieldIdentifier instanceof Sequence &&
      curve instanceof Sequence &&
      generator instanceof OctetString &&
      order instanceof Integer
    )
  ) {
    return null;
  }

  const [fieldType, prime] = sequenceChildren(fieldIdentifier);
  const [aCoefficient, bCoefficient] = sequenceChildren(curve);
  const fieldTypeOid = directObjectIdentifierValue(fieldType);
  const primeHex = integerHexValue(prime);
  const aHex = octetStringHexValue(aCoefficient);
  const bHex = octetStringHexValue(bCoefficient);
  const generatorHex = octetStringHexValue(generator);
  const orderHex = integerHexValue(order);
  const cofactorHex = integerHexValue(cofactor);

  if (!(fieldTypeOid && primeHex && aHex && bHex && generatorHex && orderHex)) {
    return null;
  }

  return {
    aHex,
    bHex,
    cofactorHex,
    fieldTypeOid,
    generatorHex,
    orderHex,
    primeHex,
  };
}

function resolveEcNamedCurve(
  algorithmParams: unknown
): { name: string; oid: string } | null {
  const directOid = directObjectIdentifierValue(algorithmParams);

  if (directOid) {
    const curve = ECNamedCurves.find(directOid);

    return curve ? { name: curve.name, oid: curve.id } : null;
  }

  const explicitCurve = explicitEcCurveParameters(algorithmParams);

  if (!explicitCurve) {
    return null;
  }

  const matchedCurve = EXPLICIT_EC_CURVES.find(
    (candidate) =>
      candidate.fieldTypeOid === explicitCurve.fieldTypeOid &&
      candidate.primeHex === explicitCurve.primeHex &&
      candidate.aHex === explicitCurve.aHex &&
      candidate.bHex === explicitCurve.bHex &&
      candidate.generatorHex === explicitCurve.generatorHex &&
      candidate.orderHex === explicitCurve.orderHex &&
      candidate.cofactorHex ===
        (explicitCurve.cofactorHex ?? candidate.cofactorHex)
  );

  return matchedCurve
    ? {
        name: matchedCurve.name,
        oid: matchedCurve.namedCurveOid,
      }
    : null;
}

function cloneCertificate(cert: Certificate): Certificate {
  const encoded = cert.toSchema().toBER(false);
  const decoded = fromBER(encoded);

  if (decoded.offset === -1) {
    throw new Error("certificate_clone_failed");
  }

  return new Certificate({
    schema: decoded.result,
  });
}

function normalizedEcCertificatePublicKeyAlgorithm(
  cert: Certificate
): Certificate {
  const publicKeyAlgorithm = cert.subjectPublicKeyInfo.algorithm;

  if (publicKeyAlgorithm.algorithmId !== ECDSA_PUBLIC_KEY_OID) {
    return cert;
  }

  const namedCurve = resolveEcNamedCurve(publicKeyAlgorithm.algorithmParams);

  if (!namedCurve) {
    return cert;
  }

  const normalizedCert = cloneCertificate(cert);

  if (
    normalizedCert.subjectPublicKeyInfo.algorithm.algorithmParams instanceof
      ObjectIdentifier &&
    normalizedCert.subjectPublicKeyInfo.algorithm.algorithmParams.valueBlock.toString() ===
      namedCurve.oid
  ) {
    return normalizedCert;
  }

  normalizedCert.subjectPublicKeyInfo.algorithm.algorithmParams =
    new ObjectIdentifier({
      value: namedCurve.oid,
    });
  normalizedCert.subjectPublicKeyInfo.parsedKey = undefined;
  return normalizedCert;
}

function signerEcNamedCurve(signerCert: Certificate): string {
  const curve = resolveEcNamedCurve(
    signerCert.subjectPublicKeyInfo.algorithm.algorithmParams
  );

  if (!curve) {
    throw new Error("cms_signature_curve_invalid");
  }

  return curve.name;
}

function importSignerVerificationKey({
  hashAlgorithm,
  signatureAlgorithm,
  signerCert,
}: {
  hashAlgorithm: SupportedHashAlgorithm;
  signatureAlgorithm: SignerInfo["signatureAlgorithm"];
  signerCert: Certificate;
}): Promise<CryptoKey> {
  if (signatureAlgorithm.algorithmId === RSA_PSS_OID) {
    const spkiBytes = signerCert.subjectPublicKeyInfo.toSchema().toBER(false);

    return crypto.subtle.importKey(
      "spki",
      spkiBytes,
      {
        name: "RSA-PSS",
        hash: hashAlgorithm,
      },
      true,
      ["verify"]
    );
  }

  const publicKeyAlgorithm = signerCert.subjectPublicKeyInfo.algorithm;
  const publicKeyAlgorithmId = publicKeyAlgorithm.algorithmId;

  if (publicKeyAlgorithmId === RSA_ENCRYPTION_OID) {
    const spkiBytes = signerCert.subjectPublicKeyInfo.toSchema().toBER(false);

    return crypto.subtle.importKey(
      "spki",
      spkiBytes,
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: hashAlgorithm,
      },
      true,
      ["verify"]
    );
  }

  if (publicKeyAlgorithmId === ECDSA_PUBLIC_KEY_OID) {
    const namedCurve = signerEcNamedCurve(signerCert);
    const spkiBytes = normalizedEcCertificatePublicKeyAlgorithm(signerCert)
      .subjectPublicKeyInfo.toSchema()
      .toBER(false);

    return crypto.subtle.importKey(
      "spki",
      spkiBytes,
      {
        name: "ECDSA",
        namedCurve,
      },
      true,
      ["verify"]
    );
  }

  throw new Error("cms_signature_algorithm_unsupported");
}

function signatureVerificationParams({
  hashAlgorithm,
  signatureAlgorithm,
  signerCert,
}: {
  hashAlgorithm: SupportedHashAlgorithm;
  signatureAlgorithm: SignerInfo["signatureAlgorithm"];
  signerCert: Certificate;
}) {
  if (signatureAlgorithm.algorithmId === RSA_PSS_OID) {
    const params = new RSASSAPSSParams({
      schema: signatureAlgorithm.algorithmParams,
    });

    return {
      name: "RSA-PSS",
      hash:
        parseSupportedHashAlgorithmName(
          getHashAlgorithm(params.hashAlgorithm) || null
        ) ?? hashAlgorithm,
      saltLength: params.saltLength ?? 20,
    };
  }

  if (
    signerCert.subjectPublicKeyInfo.algorithm.algorithmId === RSA_ENCRYPTION_OID
  ) {
    return {
      name: "RSASSA-PKCS1-v1_5",
      hash: hashAlgorithm,
    };
  }

  return {
    name: "ECDSA",
    hash: hashAlgorithm,
  };
}

async function verifySignatureWithCertificate({
  data,
  publicKeyCert,
  signatureAlgorithm,
  signatureBytes,
}: {
  data: Uint8Array;
  publicKeyCert: Certificate;
  signatureAlgorithm: AlgorithmIdentifier;
  signatureBytes: Uint8Array;
}): Promise<boolean> {
  const hashAlgorithm = algorithmIdentifierHashAlgorithm(signatureAlgorithm);

  if (!hashAlgorithm) {
    throw new Error("signature_digest_algorithm_invalid");
  }

  const verificationKey = await importSignerVerificationKey({
    hashAlgorithm,
    signatureAlgorithm,
    signerCert: publicKeyCert,
  });
  const verificationParams = signatureVerificationParams({
    hashAlgorithm,
    signatureAlgorithm,
    signerCert: publicKeyCert,
  });
  const namedCurve =
    verificationKey.algorithm.name === "ECDSA"
      ? namedCurveFromKeyAlgorithm(verificationKey.algorithm)
      : null;
  const normalizedSignatureBytes = namedCurve
    ? ecdsaSignatureBytes({
        namedCurve,
        signatureBytes,
      })
    : signatureBytes;

  return crypto.subtle.verify(
    verificationParams,
    verificationKey,
    bufferBytes(normalizedSignatureBytes),
    bufferBytes(data)
  );
}

function namedCurveFromKeyAlgorithm(
  algorithm: CryptoKey["algorithm"]
): "P-256" | "P-384" | "P-521" {
  const candidate = algorithm as CryptoKey["algorithm"] & {
    namedCurve?: string;
  };

  if (
    candidate.name !== "ECDSA" ||
    !candidate.namedCurve ||
    !SUPPORTED_NAMED_CURVES.includes(
      candidate.namedCurve as (typeof SUPPORTED_NAMED_CURVES)[number]
    )
  ) {
    throw new Error("cms_signature_curve_invalid");
  }

  return candidate.namedCurve as "P-256" | "P-384" | "P-521";
}

function issuerVerificationDetail({
  manual,
  pkijs,
  serialNumberHex,
}: {
  manual: string | null;
  pkijs: string | null;
  serialNumberHex: string;
}): string {
  return cmsDiagnosticString({
    issuer_manual: manual,
    issuer_pkijs: pkijs,
    issuer_serial: serialNumberHex,
  });
}

async function verifyCertificateIssuedBy({
  issuerCert,
  certificate,
}: {
  issuerCert: Certificate;
  certificate: Certificate;
}): Promise<{
  detail: string | null;
  ok: boolean;
}> {
  const normalizedCertificate =
    normalizedEcCertificatePublicKeyAlgorithm(certificate);
  const normalizedIssuerCert =
    normalizedEcCertificatePublicKeyAlgorithm(issuerCert);

  let pkijsDetail: string | null = null;

  try {
    const pkijsVerified =
      await normalizedCertificate.verify(normalizedIssuerCert);

    if (pkijsVerified) {
      return {
        detail: null,
        ok: true,
      };
    }

    pkijsDetail = "pkijs=false";
  } catch (error) {
    pkijsDetail = errorMessage(error);
  }

  try {
    const manualVerified = await verifySignatureWithCertificate({
      data: exactBytes(normalizedCertificate.tbsView),
      publicKeyCert: normalizedIssuerCert,
      signatureAlgorithm: normalizedCertificate.signatureAlgorithm,
      signatureBytes: exactBytes(
        normalizedCertificate.signatureValue.valueBlock.valueHexView
      ),
    });

    return {
      detail: manualVerified
        ? null
        : issuerVerificationDetail({
            manual: "manual=false",
            pkijs: pkijsDetail,
            serialNumberHex: hexBytes(
              new Uint8Array(certificate.serialNumber.valueBlock.valueHex)
            ),
          }),
      ok: manualVerified,
    };
  } catch (error) {
    return {
      detail: issuerVerificationDetail({
        manual: errorMessage(error),
        pkijs: pkijsDetail,
        serialNumberHex: hexBytes(
          new Uint8Array(certificate.serialNumber.valueBlock.valueHex)
        ),
      }),
      ok: false,
    };
  }
}

async function verifyCmsSignatureManually({
  signedData,
  signerCert,
}: {
  signedData: SignedData;
  signerCert: Certificate;
}): Promise<boolean> {
  const signerInfo = signerInfoOrThrow(signedData);
  const hashAlgorithm = signatureHashAlgorithm(signerInfo);

  if (!hashAlgorithm) {
    throw new Error("cms_signature_digest_algorithm_invalid");
  }

  const signedBytes = await signedDataBytesForSignature({
    signedData,
    signerInfo,
  });
  const rawSignatureBytes = exactBytes(
    signerInfo.signature.valueBlock.valueHexView
  );
  const verificationKey = await importSignerVerificationKey({
    hashAlgorithm,
    signatureAlgorithm: signerInfo.signatureAlgorithm,
    signerCert,
  });
  const verificationParams = signatureVerificationParams({
    hashAlgorithm,
    signatureAlgorithm: signerInfo.signatureAlgorithm,
    signerCert,
  });
  const namedCurve =
    verificationKey.algorithm.name === "ECDSA"
      ? namedCurveFromKeyAlgorithm(verificationKey.algorithm)
      : null;
  const signatureBytes = namedCurve
    ? ecdsaSignatureBytes({
        namedCurve,
        signatureBytes: rawSignatureBytes,
      })
    : rawSignatureBytes;

  return crypto.subtle.verify(
    verificationParams,
    verificationKey,
    bufferBytes(signatureBytes),
    bufferBytes(signedBytes)
  );
}

function collectTrustedIssuerCandidates(
  bundle: PkdTrustBundle,
  signerCert: Certificate
): PkdTrustBundleCertificate[] {
  const issuerKey = relativeDistinguishedNameKey(signerCert.issuer);
  const signerAkiHex = authorityKeyIdentifierHex(signerCert);
  const deduped = new Map<string, PkdTrustBundleCertificate>();

  for (const candidate of bundle.cscasBySubjectKey.get(issuerKey) ?? []) {
    deduped.set(candidate.record.derBase64, candidate);
  }

  if (signerAkiHex) {
    for (const candidate of bundle.cscasBySkiHex.get(signerAkiHex) ?? []) {
      deduped.set(candidate.record.derBase64, candidate);
    }
  }

  return [...deduped.values()];
}

async function verifyTrustedIssuer(
  bundle: PkdTrustBundle,
  signerCert: Certificate
): Promise<SignerIssuerMatchResult> {
  const candidates = collectTrustedIssuerCandidates(bundle, signerCert);

  if (candidates.length === 0) {
    return {
      detail: cmsDiagnosticString({
        issuer_aki: authorityKeyIdentifierHex(signerCert),
        issuer_candidates: 0,
      }),
      ok: false,
      reason: "chain_untrusted",
    };
  }

  const failureDetails: string[] = [];

  for (const candidate of candidates) {
    const verification = await verifyCertificateIssuedBy({
      certificate: signerCert,
      issuerCert: candidate.cert,
    });

    if (verification.ok) {
      return {
        issuer: candidate,
        ok: true,
      };
    }

    if (verification.detail) {
      failureDetails.push(verification.detail);
    }
  }

  return {
    detail: failureDetails.join("||") || null,
    ok: false,
    reason: "signer_certificate_invalid",
  };
}

function dedupeCrlEntries(
  entries: Iterable<PkdTrustBundleCrl>
): PkdTrustBundleCrl[] {
  const deduped = new Map<string, PkdTrustBundleCrl>();

  for (const entry of entries) {
    deduped.set(entry.record.derBase64, entry);
  }

  return [...deduped.values()];
}

async function collectIssuerCrlCandidates({
  bundle,
  issuer,
}: {
  bundle: PkdTrustBundle;
  issuer: PkdTrustBundleCertificate;
}): Promise<PkdTrustBundleCrl[]> {
  const issuerSkiHex =
    issuer.record.skiHex ??
    (await subjectKeyIdentifierHexOrKeyHash(issuer.cert));

  return dedupeCrlEntries([
    ...(bundle.crlsByIssuerKey.get(issuer.record.subjectKey) ?? []),
    ...(issuerSkiHex ? (bundle.crlsByAkiHex.get(issuerSkiHex) ?? []) : []),
  ]);
}

function crlIsStale(candidate: PkdTrustBundleCrl, checkDate: Date): boolean {
  return Boolean(
    candidate.crl.nextUpdate?.value &&
      candidate.crl.nextUpdate.value < checkDate
  );
}

function crlIsNotYetUsable(
  candidate: PkdTrustBundleCrl,
  checkDate: Date
): boolean {
  return candidate.crl.thisUpdate.value > checkDate;
}

async function verifyCrlForIssuer({
  candidate,
  issuer,
}: {
  candidate: PkdTrustBundleCrl;
  issuer: PkdTrustBundleCertificate;
}): Promise<boolean> {
  const normalizedIssuerCert = normalizedEcCertificatePublicKeyAlgorithm(
    issuer.cert
  );

  try {
    return await candidate.crl.verify({
      issuerCertificate: normalizedIssuerCert,
    });
  } catch {
    try {
      return await verifySignatureWithCertificate({
        data: exactBytes(candidate.crl.tbsView),
        publicKeyCert: normalizedIssuerCert,
        signatureAlgorithm: candidate.crl.signatureAlgorithm,
        signatureBytes: exactBytes(
          candidate.crl.signatureValue.valueBlock.valueHexView
        ),
      });
    } catch {
      return false;
    }
  }
}

async function evaluateCrlStatus({
  bundle,
  checkDate,
  issuer,
  signerCert,
}: {
  bundle: PkdTrustBundle;
  checkDate: Date;
  issuer: PkdTrustBundleCertificate;
  signerCert: Certificate;
}): Promise<Exclude<PassiveAuthCrlStatus, "not_checked">> {
  const candidates = await collectIssuerCrlCandidates({
    bundle,
    issuer,
  });

  if (candidates.length === 0) {
    return "soft_fail_missing";
  }

  const verifiedCandidates: Array<{
    candidate: PkdTrustBundleCrl;
    state: CrlVerificationState;
  }> = [];

  for (const candidate of candidates) {
    if (crlIsNotYetUsable(candidate, checkDate)) {
      continue;
    }

    if (
      !(await verifyCrlForIssuer({
        candidate,
        issuer,
      }))
    ) {
      continue;
    }

    verifiedCandidates.push({
      candidate,
      state: crlIsStale(candidate, checkDate)
        ? "stale_verified"
        : "current_verified",
    });
  }

  const currentVerifiedCandidates = verifiedCandidates
    .filter((entry) => entry.state === "current_verified")
    .map((entry) => entry.candidate)
    .sort((left, right) => {
      const thisUpdateDelta =
        right.crl.thisUpdate.value.getTime() -
        left.crl.thisUpdate.value.getTime();

      if (thisUpdateDelta !== 0) {
        return thisUpdateDelta;
      }

      const leftNextUpdate = left.crl.nextUpdate?.value.getTime() ?? -1;
      const rightNextUpdate = right.crl.nextUpdate?.value.getTime() ?? -1;
      const nextUpdateDelta = rightNextUpdate - leftNextUpdate;

      if (nextUpdateDelta !== 0) {
        return nextUpdateDelta;
      }

      return left.record.derBase64.localeCompare(right.record.derBase64);
    });

  if (currentVerifiedCandidates.length > 0) {
    for (const candidate of currentVerifiedCandidates) {
      if (candidate.crl.isCertificateRevoked(signerCert)) {
        return "revoked";
      }
    }

    return "verified_not_revoked";
  }

  return verifiedCandidates.some((entry) => entry.state === "stale_verified")
    ? "soft_fail_stale"
    : "soft_fail_missing";
}

function normalizeFailureReason(error: unknown): PassiveAuthFailureReason {
  const reason = error instanceof Error ? error.message : "";

  if (reason === "required_dg_hash_missing") {
    return "required_dg_hash_missing";
  }

  if (reason === "unsupported_digest_algorithm") {
    return "unsupported_digest_algorithm";
  }

  return "parse_failure";
}

function failureResult({
  crlStatus = "not_checked",
  detail = null,
  reason,
  signerSource = null,
}: {
  crlStatus?: PassiveAuthCrlStatus;
  detail?: string | null;
  reason: PassiveAuthFailureReason;
  signerSource?: PassiveAuthSignerSource | null;
}): AuthenticityValidationResult {
  return {
    crlStatus,
    detail,
    ok: false,
    reason,
    signerSource,
  };
}

async function validateSignerCandidate({
  bundle,
  checkDate,
  signedData,
  signer,
}: {
  bundle: PkdTrustBundle;
  checkDate: Date;
  signedData: SignedData;
  signer: ResolvedSignerCertificate;
}): Promise<
  | {
      crlStatus: Exclude<PassiveAuthCrlStatus, "not_checked" | "revoked">;
      ok: true;
    }
  | {
      failure: AuthenticityValidationResult;
      ok: false;
    }
> {
  const validityFailureReason = signerValidityFailureReason(
    signer.cert,
    checkDate
  );

  if (validityFailureReason) {
    return {
      failure: failureResult({
        reason: validityFailureReason,
        signerSource: signer.signerSource,
      }),
      ok: false,
    };
  }

  const cmsSignature = await verifyCmsSignature({
    checkDate,
    signedData,
    signerCert: signer.cert,
  });

  if (!cmsSignature.ok) {
    return {
      failure: failureResult({
        detail: cmsSignature.detail,
        reason: "cms_signature_invalid",
        signerSource: signer.signerSource,
      }),
      ok: false,
    };
  }

  const trustedIssuer = await verifyTrustedIssuer(bundle, signer.cert);

  if (!trustedIssuer.ok) {
    return {
      failure: failureResult({
        detail: trustedIssuer.detail,
        reason: trustedIssuer.reason,
        signerSource: signer.signerSource,
      }),
      ok: false,
    };
  }

  const crlStatus = await evaluateCrlStatus({
    bundle,
    checkDate,
    issuer: trustedIssuer.issuer,
    signerCert: signer.cert,
  });

  if (crlStatus === "revoked") {
    return {
      failure: failureResult({
        crlStatus,
        reason: "crl_revoked",
        signerSource: signer.signerSource,
      }),
      ok: false,
    };
  }

  return {
    crlStatus,
    ok: true,
  };
}

export async function validateAuthenticity({
  checkDate = new Date(),
  dg1,
  dg2,
  sod,
  trustBundle,
}: {
  checkDate?: Date;
  dg1: Uint8Array;
  dg2: Uint8Array;
  sod: Uint8Array;
  trustBundle?: PkdTrustBundle;
}): Promise<AuthenticityValidationResult> {
  if (!(dg1.length && dg2.length && sod.length)) {
    return failureResult({
      reason: "missing_required_artifacts",
    });
  }

  let parsed: ParsedSodSecurityObject;

  try {
    parsed = parseSodSecurityObject(sod);
  } catch (error) {
    return failureResult({
      reason: normalizeFailureReason(error),
    });
  }

  const signerInfos: SignedData["signerInfos"] | Error = (() => {
    try {
      return signerInfosOrThrow(parsed.signedData);
    } catch (error) {
      return error instanceof Error ? error : new Error("missing_signer");
    }
  })();

  if (signerInfos instanceof Error) {
    return failureResult({
      reason: "missing_signer",
    });
  }

  const [dg1Digest, dg2Digest] = await Promise.all([
    createDigest(parsed.algorithm, dg1),
    createDigest(parsed.algorithm, dg2),
  ]);

  if (
    !(
      bytesEqual(dg1Digest, parsed.dg1Hash) &&
      bytesEqual(dg2Digest, parsed.dg2Hash)
    )
  ) {
    return failureResult({
      reason: "dg_hash_mismatch",
    });
  }

  const bundle = (() => {
    if (trustBundle) {
      return Promise.resolve(trustBundle);
    }

    return loadPkdTrustBundle();
  })();

  let resolvedTrustBundle: PkdTrustBundle | null;

  try {
    resolvedTrustBundle = await bundle;
  } catch {
    resolvedTrustBundle = null;
  }

  if (!resolvedTrustBundle) {
    return failureResult({
      reason: "trust_bundle_unavailable",
    });
  }

  let signerCandidates: ResolvedSignerCertificate[];

  try {
    signerCandidates = await resolveSignerCertificates({
      bundle: resolvedTrustBundle,
      signedData: parsed.signedData,
      signerInfo: signerInfos[0],
    });
  } catch {
    return failureResult({
      reason: "signer_certificate_invalid",
    });
  }

  if (signerCandidates.length === 0) {
    return failureResult({
      reason: "missing_signer_certificate",
    });
  }

  let candidateFailure: AuthenticityValidationResult | null = null;

  for (const signer of signerCandidates) {
    const evaluation = await validateSignerCandidate({
      bundle: resolvedTrustBundle,
      checkDate,
      signedData: parsed.signedData,
      signer,
    });

    if (!evaluation.ok) {
      candidateFailure ??= evaluation.failure;
      continue;
    }

    return {
      algorithm: parsed.algorithm,
      crlStatus: evaluation.crlStatus,
      ok: true,
      signerSource: signer.signerSource,
      source: "cms_signed_data",
    };
  }

  return (
    candidateFailure ??
    failureResult({
      reason: "signer_certificate_invalid",
    })
  );
}
