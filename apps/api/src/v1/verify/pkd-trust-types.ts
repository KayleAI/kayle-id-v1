import type { Certificate, CertificateRevocationList } from "pkijs";

export const ICAO_MASTER_LIST_OID = "2.23.136.1.1.2";
export const PKD_TRUST_BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000;
export const PKD_TRUST_BUNDLE_VERSION = 2;
export const PKD_TRUST_R2_KEY = "verify/pkd-trust/latest.json";
export const PKD_TRUST_R2_DSC_SEGMENT_KEY_PREFIX =
  "verify/pkd-trust/dsc-country";
export const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
export const AUTHORITY_KEY_IDENTIFIER_OID = "2.5.29.35";

export const INLINE_PKD_TRUST_BUNDLE_ENV_KEY = "VERIFY_PKD_TRUST_BUNDLE_JSON";
export const TRUST_STORE_METADATA_ID = 1;

export type PkdTrustR2ObjectBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpEtag: string;
};

export type PkdTrustR2Bucket = {
  get(key: string): Promise<PkdTrustR2ObjectBody | null>;
};

export type PkdTrustD1PreparedStatement = {
  all<T = Record<string, unknown>>(): Promise<{
    results?: T[];
  }>;
  bind(...values: unknown[]): PkdTrustD1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
};

export type PkdTrustD1Database = {
  prepare(query: string): PkdTrustD1PreparedStatement;
};

export type PkdTrustBundleLoader = () => Promise<PkdTrustBundle | null>;
export type PkdTrustBundleDscSegmentLoader = (
  segmentKey: string
) => Promise<PkdTrustBundleDscSegment | null>;
export type PkdTrustBundleDscRecordByIssuerSerialLoader = (
  issuerKey: string,
  serialNumberHex: string
) => Promise<PkdCertificateRecord | null>;
export type PkdTrustBundleDscRecordsBySkiLoader = (
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

export type TrustStoreMetadataRow = {
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

export type TrustStoreCscaRow = Omit<PkdCscaRecord, "masterListSources"> & {
  masterListSourcesJson: string;
};

export type TrustStoreCrlRow = {
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

export type TrustStoreCrlRevocationRow = {
  crlId: number;
  revokedSerialNumberHex: string;
};

export type PkdTrustBundleCache = {
  bundle: PkdTrustBundle | null;
  etag: string | null;
  expiresAt: number;
};
