import {
  BitString,
  fromBER,
  Integer,
  Null,
  ObjectIdentifier,
  OctetString,
  Primitive,
  PrintableString,
  Sequence,
  Utf8String,
} from "asn1js";
import jpeg from "jpeg-js";
import {
  AlgorithmIdentifier,
  Attribute,
  AttributeTypeAndValue,
  AuthorityKeyIdentifier,
  BasicConstraints,
  Certificate,
  CertificateRevocationList,
  ContentInfo,
  EncapsulatedContentInfo,
  Extension,
  Extensions,
  IssuerAndSerialNumber,
  RevokedCertificate,
  SignedAndUnsignedAttributes,
  SignedData,
  SignerInfo,
  Time,
} from "pkijs";
import {
  createPkdCertificateRecord,
  createPkdCrlRecord,
  ensurePkijsEngine,
  hydratePkdTrustBundle,
  subjectKeyIdentifierHex,
} from "@/v1/verify/pkd-trust";
import type { PassiveAuthTrustBundle } from "@/v1/verify/validation";

const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
const ICAO_LDS_SECURITY_OBJECT_OID = "2.23.136.1.1.1";
const SHA_1_OID = "1.3.14.3.2.26";
const SHA_256_OID = "2.16.840.1.101.3.4.2.1";
const SHA_384_OID = "2.16.840.1.101.3.4.2.2";
const SHA_512_OID = "2.16.840.1.101.3.4.2.3";
const FAC_HEADER = [0x46, 0x41, 0x43, 0x00] as const;
const ONE_BYTE = 0x1_00;
const SHORT_LENGTH_MAX = 0x80;
const LONG_LENGTH_PREFIX = 0x80;
const ISO_19794_5_VERSION = 0x30_31_30_00;
const DG2_FILE_TAG = 0x75;
const DG2_ROOT_TAG = 0x7f_61;
const DG2_BIOMETRIC_GROUP_TAG = 0x7f_60;
const DG2_BIOMETRIC_DATA_TAG = 0x5f_2e;
const DG1_ROOT_TAG = 0x61;
const DG1_MRZ_TAG = 0x5f_1f;
const PKD_TRUST_BUNDLE_VERSION = 1 as const;
const TEST_PASSIVE_AUTH_COUNTRY_CODE = "UT";
const TEST_CA_COMMON_NAME = "Kayle Test CSCA";
const TEST_DSC_COMMON_NAME = "Kayle Test DSC";
const TEST_PASSIVE_AUTH_BUNDLE_SOURCE_DN =
  "cn=Kayle Test PKD Source,o=Kayle Test";
const TEST_PASSIVE_AUTH_MASTER_LIST_DN =
  "cn=Kayle Test Master List,o=Kayle Test";
const BASIC_CONSTRAINTS_OID = "2.5.29.19";
const KEY_USAGE_OID = "2.5.29.15";
const SUBJECT_KEY_IDENTIFIER_OID = "2.5.29.14";
const AUTHORITY_KEY_IDENTIFIER_OID = "2.5.29.35";
const DEFAULT_CA_NOT_BEFORE = new Date("2024-01-01T00:00:00.000Z");
const DEFAULT_CA_NOT_AFTER = new Date("2034-01-01T00:00:00.000Z");
const DEFAULT_DSC_NOT_BEFORE = new Date("2024-06-01T00:00:00.000Z");
const DEFAULT_DSC_NOT_AFTER = new Date("2026-06-01T00:00:00.000Z");
const DEFAULT_CRL_THIS_UPDATE = new Date("2024-12-01T00:00:00.000Z");
const DEFAULT_CRL_NEXT_UPDATE = new Date("2025-12-01T00:00:00.000Z");

type SupportedHashAlgorithm = "SHA-256" | "SHA-384" | "SHA-512" | "SHA-1";
type SupportedImageFormat = "jpeg" | "jpeg2000";
type FixtureName = "icon.jpg" | "icon.jp2" | "black.jpg";
const DEFAULT_VALIDATION_PORTRAIT_SIZE = 160;

type TestCertificateMaterial = {
  cert: Certificate;
  derBytes: Uint8Array;
  keyPair: CryptoKeyPair;
};

type TestKeyType = "ec" | "rsa";
type TestEcNamedCurve = "P-256" | "P-384" | "P-521";

export type PassiveAuthTestChain = {
  csca: TestCertificateMaterial;
  dsc: TestCertificateMaterial;
  trustBundle: PassiveAuthTrustBundle;
};

export const TEST_PASSIVE_AUTH_CHECK_DATE = new Date(
  "2025-01-15T00:00:00.000Z"
);

const verifyFixtureBaseUrl = new URL("../fixtures/verify/", import.meta.url);
const fixtureCache = new Map<FixtureName, Promise<Uint8Array>>();
const validationPortraitCache = new Map<string, Promise<Uint8Array>>();

type BunFileRuntime = {
  file(path: URL): {
    arrayBuffer(): Promise<ArrayBuffer>;
  };
};

function bufferBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

function hexBytes(value: string): Uint8Array {
  if (value.length % 2 !== 0) {
    throw new Error("hex_value_length_invalid");
  }

  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}

function uintBytes(value: number, length: number): number[] {
  const bytes = new Array<number>(length);
  let remaining = value;

  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % ONE_BYTE;
    remaining = Math.floor(remaining / ONE_BYTE);
  }

  return bytes;
}

function tagBytes(tag: number): number[] {
  const hex = tag.toString(16).padStart(tag > 0xff ? 4 : 2, "0");
  const bytes: number[] = [];

  for (let index = 0; index < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }

  return bytes;
}

function lengthBytes(length: number): number[] {
  if (length < SHORT_LENGTH_MAX) {
    return [length];
  }

  const encoded: number[] = [];
  let remaining = length;

  while (remaining > 0) {
    encoded.unshift(remaining % ONE_BYTE);
    remaining = Math.floor(remaining / ONE_BYTE);
  }

  return [LONG_LENGTH_PREFIX + encoded.length, ...encoded];
}

function encodeTlv(tag: number, value: Uint8Array): Uint8Array {
  return Uint8Array.from([
    ...tagBytes(tag),
    ...lengthBytes(value.length),
    ...value,
  ]);
}

function hashAlgorithmOid(algorithm: SupportedHashAlgorithm): string {
  switch (algorithm) {
    case "SHA-1":
      return SHA_1_OID;
    case "SHA-256":
      return SHA_256_OID;
    case "SHA-384":
      return SHA_384_OID;
    case "SHA-512":
      return SHA_512_OID;
    default:
      throw new Error(`unsupported_hash_algorithm:${algorithm}`);
  }
}

function createAlgorithmIdentifier(
  algorithm: SupportedHashAlgorithm
): AlgorithmIdentifier {
  return new AlgorithmIdentifier({
    algorithmId: hashAlgorithmOid(algorithm),
    algorithmParams: new Null(),
  });
}

function cloneDate(date: Date): Date {
  return new Date(date.toISOString());
}

function createName({
  commonName,
  countryCode = TEST_PASSIVE_AUTH_COUNTRY_CODE,
}: {
  commonName: string;
  countryCode?: string;
}): Certificate["subject"] {
  const name = new Certificate().subject;
  name.typesAndValues.push(
    new AttributeTypeAndValue({
      type: "2.5.4.6",
      value: new PrintableString({
        value: countryCode,
      }),
    })
  );
  name.typesAndValues.push(
    new AttributeTypeAndValue({
      type: "2.5.4.3",
      value: new Utf8String({
        value: commonName,
      }),
    })
  );
  return name;
}

function createKeyUsageExtension(bits: Uint8Array): Extension {
  return new Extension({
    critical: true,
    extnID: KEY_USAGE_OID,
    extnValue: new BitString({
      valueHex: bufferBytes(bits),
    }).toBER(false),
  });
}

async function certificateKeyIdentifierBytes(
  cert: Certificate
): Promise<Uint8Array> {
  return new Uint8Array(await cert.getKeyHash("SHA-1"));
}

async function authorityKeyIdentifierBytesForCertificate(
  cert: Certificate
): Promise<Uint8Array> {
  const subjectKeyIdentifier = await subjectKeyIdentifierHex(cert);

  return subjectKeyIdentifier
    ? hexBytes(subjectKeyIdentifier)
    : certificateKeyIdentifierBytes(cert);
}

function createSubjectKeyIdentifierExtension(
  keyIdentifierBytes: Uint8Array
): Extension {
  return new Extension({
    extnID: SUBJECT_KEY_IDENTIFIER_OID,
    extnValue: new OctetString({
      valueHex: bufferBytes(keyIdentifierBytes),
    }).toBER(false),
  });
}

function createAuthorityKeyIdentifierExtension(
  keyIdentifierBytes: Uint8Array
): Extension {
  return new Extension({
    extnID: AUTHORITY_KEY_IDENTIFIER_OID,
    extnValue: new AuthorityKeyIdentifier({
      keyIdentifier: new OctetString({
        valueHex: bufferBytes(keyIdentifierBytes),
      }),
    })
      .toSchema()
      .toBER(false),
  });
}

async function createCertificate({
  includeAuthorityKeyIdentifier,
  includeSubjectKeyIdentifier = true,
  commonName,
  countryCode = TEST_PASSIVE_AUTH_COUNTRY_CODE,
  issuer,
  issuerPrivateKey,
  isCertificateAuthority,
  keyPair,
  notAfter,
  notBefore,
  serialNumber,
}: {
  commonName: string;
  countryCode?: string;
  includeAuthorityKeyIdentifier?: boolean;
  includeSubjectKeyIdentifier?: boolean;
  issuer?: Certificate;
  issuerPrivateKey?: CryptoKey;
  isCertificateAuthority: boolean;
  keyPair: CryptoKeyPair;
  notAfter: Date;
  notBefore: Date;
  serialNumber: number;
}): Promise<TestCertificateMaterial> {
  ensurePkijsEngine();
  const shouldIncludeAuthorityKeyIdentifier =
    includeAuthorityKeyIdentifier ?? Boolean(issuer);
  const cert = new Certificate();
  cert.version = 2;
  cert.serialNumber = new Integer({
    value: serialNumber,
  });
  cert.issuer = issuer
    ? issuer.subject
    : createName({
        commonName,
        countryCode,
      });
  cert.subject = createName({
    commonName,
    countryCode,
  });
  cert.notBefore = new Time({
    value: cloneDate(notBefore),
  });
  cert.notAfter = new Time({
    value: cloneDate(notAfter),
  });
  await cert.subjectPublicKeyInfo.importKey(keyPair.publicKey);
  const extensions: Extension[] = [
    new Extension({
      critical: true,
      extnID: BASIC_CONSTRAINTS_OID,
      extnValue: new BasicConstraints({
        cA: isCertificateAuthority,
      })
        .toSchema()
        .toBER(false),
    }),
    createKeyUsageExtension(
      isCertificateAuthority ? Uint8Array.of(0x06) : Uint8Array.of(0x80)
    ),
  ];
  const subjectKeyIdentifierBytes = await certificateKeyIdentifierBytes(cert);

  if (includeSubjectKeyIdentifier) {
    extensions.push(
      createSubjectKeyIdentifierExtension(subjectKeyIdentifierBytes)
    );
  }

  if (shouldIncludeAuthorityKeyIdentifier && issuer) {
    extensions.push(
      createAuthorityKeyIdentifierExtension(
        await authorityKeyIdentifierBytesForCertificate(issuer)
      )
    );
  }

  cert.extensions = extensions;
  await cert.sign(issuerPrivateKey ?? keyPair.privateKey, "SHA-256");

  return {
    cert,
    derBytes: new Uint8Array(cert.toSchema().toBER(false)),
    keyPair,
  };
}

export async function createCertificateRevocationListArtifact({
  includeAuthorityKeyIdentifier = true,
  issuer,
  issuerPrivateKey,
  nextUpdate,
  revokedCertificates = [],
  thisUpdate,
}: {
  includeAuthorityKeyIdentifier?: boolean;
  issuer: Certificate;
  issuerPrivateKey: CryptoKey;
  nextUpdate?: Date;
  revokedCertificates?: Certificate[];
  thisUpdate: Date;
}): Promise<{
  crl: CertificateRevocationList;
  derBytes: Uint8Array;
}> {
  ensurePkijsEngine();
  const crl = new CertificateRevocationList();
  crl.version = 1;
  crl.issuer = issuer.subject;
  crl.thisUpdate = new Time({
    value: cloneDate(thisUpdate),
  });
  if (nextUpdate) {
    crl.nextUpdate = new Time({
      value: cloneDate(nextUpdate),
    });
  }
  if (includeAuthorityKeyIdentifier) {
    crl.crlExtensions = new Extensions({
      extensions: [
        createAuthorityKeyIdentifierExtension(
          await authorityKeyIdentifierBytesForCertificate(issuer)
        ),
      ],
    });
  }
  crl.revokedCertificates = revokedCertificates.map(
    (certificate) =>
      new RevokedCertificate({
        revocationDate: new Time({
          value: cloneDate(thisUpdate),
        }),
        userCertificate: certificate.serialNumber,
      })
  );
  await crl.sign(issuerPrivateKey, "SHA-256");

  return {
    crl,
    derBytes: new Uint8Array(crl.toSchema().toBER(false)),
  };
}

async function createTrustBundle({
  cscas,
  crls,
  dscs,
}: {
  cscas: TestCertificateMaterial[];
  crls: Array<{
    crl: CertificateRevocationList;
    derBytes: Uint8Array;
  }>;
  dscs: TestCertificateMaterial[];
}): Promise<PassiveAuthTrustBundle> {
  const cscaRecords = await Promise.all(
    cscas.map(({ cert, derBytes }) =>
      createPkdCertificateRecord({
        cert,
        derBytes,
        masterListSources: [
          {
            countryCode: TEST_PASSIVE_AUTH_COUNTRY_CODE,
            dn: TEST_PASSIVE_AUTH_MASTER_LIST_DN,
          },
        ],
        sourceCountryCode: TEST_PASSIVE_AUTH_COUNTRY_CODE,
        sourceDn: TEST_PASSIVE_AUTH_MASTER_LIST_DN,
      })
    )
  );
  const dscRecords = await Promise.all(
    dscs.map(({ cert, derBytes }) =>
      createPkdCertificateRecord({
        cert,
        derBytes,
        sourceCountryCode: TEST_PASSIVE_AUTH_COUNTRY_CODE,
        sourceDn: TEST_PASSIVE_AUTH_BUNDLE_SOURCE_DN,
      })
    )
  );
  const crlRecords = crls.map(({ crl, derBytes }) =>
    createPkdCrlRecord({
      crl,
      derBytes,
      sourceCountryCode: TEST_PASSIVE_AUTH_COUNTRY_CODE,
      sourceDn: TEST_PASSIVE_AUTH_BUNDLE_SOURCE_DN,
    })
  );

  return hydratePkdTrustBundle({
    counts: {
      cscas: cscaRecords.length,
      crls: crlRecords.length,
      dscs: dscRecords.length,
      ignoredBcsc: 0,
      ignoredBcscNc: 0,
    },
    cscas: cscaRecords,
    crls: crlRecords,
    dscs: dscRecords,
    generatedAt: TEST_PASSIVE_AUTH_CHECK_DATE.toISOString(),
    sources: {
      masterListsLdif: {
        path: "tests://master-list.ldif",
        version: "test",
      },
      objectLdif: {
        path: "tests://objects.ldif",
        version: "test",
      },
    },
    version: PKD_TRUST_BUNDLE_VERSION,
  });
}

function generateEcKeyPair(
  namedCurve: TestEcNamedCurve = "P-256"
): Promise<CryptoKeyPair> {
  return crypto.subtle
    .generateKey(
      {
        name: "ECDSA",
        namedCurve,
      },
      true,
      ["sign", "verify"]
    )
    .then((keyPair) => {
      if (!("publicKey" in keyPair && "privateKey" in keyPair)) {
        throw new Error("ec_keypair_generation_failed");
      }

      return keyPair;
    });
}

function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle
    .generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: Uint8Array.of(0x01, 0x00, 0x01),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"]
    )
    .then((keyPair) => {
      if (!("publicKey" in keyPair && "privateKey" in keyPair)) {
        throw new Error("rsa_keypair_generation_failed");
      }

      return keyPair;
    });
}

export async function createPassiveAuthTestChain({
  includeCrlAuthorityKeyIdentifier = true,
  includeCscaSubjectKeyIdentifier = true,
  includeDscAuthorityKeyIdentifier = true,
  includeDscSubjectKeyIdentifier = true,
  cscaCommonName = TEST_CA_COMMON_NAME,
  cscaEcNamedCurve = "P-256",
  cscaKeyType = "ec",
  countryCode = TEST_PASSIVE_AUTH_COUNTRY_CODE,
  dscEcNamedCurve = "P-256",
  dscKeyType = "ec",
  dscCommonName = TEST_DSC_COMMON_NAME,
  dscNotAfter = DEFAULT_DSC_NOT_AFTER,
  dscNotBefore = DEFAULT_DSC_NOT_BEFORE,
  includeCrl = true,
  invalidDscSignature = false,
  revokeDsc = false,
  staleCrl = false,
}: {
  cscaCommonName?: string;
  cscaEcNamedCurve?: TestEcNamedCurve;
  cscaKeyType?: TestKeyType;
  countryCode?: string;
  dscEcNamedCurve?: TestEcNamedCurve;
  dscKeyType?: TestKeyType;
  dscCommonName?: string;
  dscNotAfter?: Date;
  dscNotBefore?: Date;
  includeCrlAuthorityKeyIdentifier?: boolean;
  includeCscaSubjectKeyIdentifier?: boolean;
  includeDscAuthorityKeyIdentifier?: boolean;
  includeDscSubjectKeyIdentifier?: boolean;
  includeCrl?: boolean;
  invalidDscSignature?: boolean;
  revokeDsc?: boolean;
  staleCrl?: boolean;
} = {}): Promise<PassiveAuthTestChain> {
  const cscaKeys =
    cscaKeyType === "rsa"
      ? await generateRsaKeyPair()
      : await generateEcKeyPair(cscaEcNamedCurve);
  const csca = await createCertificate({
    commonName: cscaCommonName,
    countryCode,
    includeSubjectKeyIdentifier: includeCscaSubjectKeyIdentifier,
    isCertificateAuthority: true,
    keyPair: cscaKeys,
    notAfter: DEFAULT_CA_NOT_AFTER,
    notBefore: DEFAULT_CA_NOT_BEFORE,
    serialNumber: 1001,
  });
  const dscKeys =
    dscKeyType === "rsa"
      ? await generateRsaKeyPair()
      : await generateEcKeyPair(dscEcNamedCurve);
  const invalidIssuerKeys = invalidDscSignature
    ? await generateEcKeyPair(cscaEcNamedCurve)
    : null;
  const dsc = await createCertificate({
    commonName: dscCommonName,
    countryCode,
    includeAuthorityKeyIdentifier: includeDscAuthorityKeyIdentifier,
    includeSubjectKeyIdentifier: includeDscSubjectKeyIdentifier,
    issuer: csca.cert,
    issuerPrivateKey: invalidIssuerKeys?.privateKey ?? csca.keyPair.privateKey,
    isCertificateAuthority: false,
    keyPair: dscKeys,
    notAfter: dscNotAfter,
    notBefore: dscNotBefore,
    serialNumber: 2001,
  });
  const crls = includeCrl
    ? [
        await createCertificateRevocationListArtifact({
          includeAuthorityKeyIdentifier: includeCrlAuthorityKeyIdentifier,
          issuer: csca.cert,
          issuerPrivateKey: csca.keyPair.privateKey,
          nextUpdate: staleCrl
            ? new Date("2024-12-31T00:00:00.000Z")
            : DEFAULT_CRL_NEXT_UPDATE,
          revokedCertificates: revokeDsc ? [dsc.cert] : [],
          thisUpdate: DEFAULT_CRL_THIS_UPDATE,
        }),
      ]
    : [];

  return {
    csca,
    dsc,
    trustBundle: await createTrustBundle({
      cscas: [csca],
      crls,
      dscs: [dsc],
    }),
  };
}

let defaultPassiveAuthChainPromise: Promise<PassiveAuthTestChain> | null = null;

function loadDefaultPassiveAuthChain(): Promise<PassiveAuthTestChain> {
  defaultPassiveAuthChainPromise ??= createPassiveAuthTestChain();

  return defaultPassiveAuthChainPromise;
}

export function createSelfieJpeg({
  blue,
  green,
  height = 64,
  red,
  width = 64,
}: {
  red: number;
  green: number;
  blue: number;
  width?: number;
  height?: number;
}): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);

  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = red;
    rgba[offset + 1] = green;
    rgba[offset + 2] = blue;
    rgba[offset + 3] = 255;
  }

  const encoded = jpeg.encode(
    {
      data: rgba,
      width,
      height,
    },
    90
  );

  return new Uint8Array(encoded.data);
}

export function createLowSimilaritySelfies(): Uint8Array[] {
  return [
    createSelfieJpeg({
      red: 0,
      green: 0,
      blue: 0,
    }),
    createSelfieJpeg({
      red: 255,
      green: 255,
      blue: 255,
    }),
  ];
}

export function createTd3MrzText(): string {
  return [
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
  ].join("\n");
}

export function createDg1Artifact(mrzText: string): Uint8Array {
  const mrzBytes = new TextEncoder().encode(mrzText);
  return encodeTlv(DG1_ROOT_TAG, encodeTlv(DG1_MRZ_TAG, mrzBytes));
}

export async function createMismatchValidationSelfies(): Promise<Uint8Array[]> {
  return [
    ...createLowSimilaritySelfies(),
    await loadVerifyFixtureBytes("black.jpg"),
  ];
}

export async function createMatchingValidationSelfies(): Promise<Uint8Array[]> {
  return [
    await createValidationPortraitJpeg(),
    ...createLowSimilaritySelfies(),
  ];
}

export function createDg2Artifact({
  imageData,
  imageFormat,
  imageHeight = 32,
  imageWidth = 32,
  wrapWithEfTag = false,
}: {
  imageData: Uint8Array;
  imageFormat: SupportedImageFormat;
  imageWidth?: number;
  imageHeight?: number;
  wrapWithEfTag?: boolean;
}): Uint8Array {
  const facialRecordLength = 42 + imageData.length;
  const iso197945Record = Uint8Array.from([
    ...FAC_HEADER,
    ...uintBytes(ISO_19794_5_VERSION, 4),
    ...uintBytes(facialRecordLength, 4),
    ...uintBytes(1, 2),
    ...uintBytes(facialRecordLength, 4),
    ...uintBytes(0, 2),
    0x00,
    0x00,
    0x00,
    ...uintBytes(0, 3),
    ...uintBytes(0, 2),
    ...uintBytes(0, 3),
    ...uintBytes(0, 3),
    0x00,
    imageFormat === "jpeg" ? 0x00 : 0x01,
    ...uintBytes(imageWidth, 2),
    ...uintBytes(imageHeight, 2),
    0x01,
    0x02,
    ...uintBytes(0, 2),
    ...uintBytes(100, 2),
    ...imageData,
  ]);

  const biometricData = encodeTlv(DG2_BIOMETRIC_DATA_TAG, iso197945Record);
  const biometricHeader = encodeTlv(0xa1, new Uint8Array());
  const biometricGroup = encodeTlv(
    DG2_BIOMETRIC_GROUP_TAG,
    Uint8Array.from([...biometricHeader, ...biometricData])
  );

  const biometricRoot = encodeTlv(
    DG2_ROOT_TAG,
    Uint8Array.from([...encodeTlv(0x02, Uint8Array.of(1)), ...biometricGroup])
  );

  return wrapWithEfTag ? encodeTlv(DG2_FILE_TAG, biometricRoot) : biometricRoot;
}

export function createMalformedDg2Artifact(): Uint8Array {
  return encodeTlv(
    DG2_ROOT_TAG,
    Uint8Array.from([
      ...encodeTlv(0x02, Uint8Array.of(1)),
      ...encodeTlv(
        DG2_BIOMETRIC_GROUP_TAG,
        Uint8Array.from([
          ...encodeTlv(0xa1, new Uint8Array()),
          ...encodeTlv(
            DG2_BIOMETRIC_DATA_TAG,
            new Uint8Array([0x00, 0x01, 0x02])
          ),
        ])
      ),
    ])
  );
}

function getBunRuntime(): BunFileRuntime | null {
  const maybeBun = (
    globalThis as typeof globalThis & {
      Bun?: BunFileRuntime;
    }
  ).Bun;

  return typeof maybeBun?.file === "function" ? maybeBun : null;
}

export async function loadVerifyFixtureBytes(
  name: FixtureName
): Promise<Uint8Array> {
  let promise = fixtureCache.get(name);

  if (!promise) {
    const bunRuntime = getBunRuntime();

    if (!bunRuntime) {
      throw new Error("bun_runtime_required_for_verify_fixtures");
    }

    promise = bunRuntime
      .file(new URL(name, verifyFixtureBaseUrl))
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer));
    fixtureCache.set(name, promise);
  }

  return exactBytes(await promise);
}

function exactBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function resizeRgbaNearestNeighbor({
  data,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}: {
  data: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
}): Uint8Array {
  const resized = new Uint8Array(targetWidth * targetHeight * 4);

  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const sourceY = Math.min(
      sourceHeight - 1,
      Math.floor((targetY * sourceHeight) / targetHeight)
    );

    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.min(
        sourceWidth - 1,
        Math.floor((targetX * sourceWidth) / targetWidth)
      );
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (targetY * targetWidth + targetX) * 4;

      resized[targetOffset] = data[sourceOffset] ?? 0;
      resized[targetOffset + 1] = data[sourceOffset + 1] ?? 0;
      resized[targetOffset + 2] = data[sourceOffset + 2] ?? 0;
      resized[targetOffset + 3] = data[sourceOffset + 3] ?? 255;
    }
  }

  return resized;
}

export async function createValidationPortraitJpeg({
  height = DEFAULT_VALIDATION_PORTRAIT_SIZE,
  width = DEFAULT_VALIDATION_PORTRAIT_SIZE,
}: {
  width?: number;
  height?: number;
} = {}): Promise<Uint8Array> {
  const cacheKey = `${width}x${height}`;
  const cached = validationPortraitCache.get(cacheKey);

  if (cached) {
    return exactBytes(await cached);
  }

  const promise = loadVerifyFixtureBytes("icon.jpg").then((sourceBytes) => {
    const decoded = jpeg.decode(sourceBytes, {
      useTArray: true,
    });

    if (decoded.width === width && decoded.height === height) {
      return exactBytes(sourceBytes);
    }

    const resized = resizeRgbaNearestNeighbor({
      data: decoded.data,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      targetWidth: width,
      targetHeight: height,
    });

    return Uint8Array.from(
      jpeg.encode(
        {
          data: resized,
          width,
          height,
        },
        90
      ).data
    );
  });

  validationPortraitCache.set(cacheKey, promise);
  return exactBytes(await promise);
}

export async function createUnsignedSodArtifact({
  algorithm = "SHA-256",
  dg1,
  dg1HashOverride,
  dg2,
  dg2HashOverride,
  includeDg1Hash = true,
  includeDg2Hash = true,
}: {
  dg1: Uint8Array;
  dg2: Uint8Array;
  algorithm?: SupportedHashAlgorithm;
  includeDg1Hash?: boolean;
  includeDg2Hash?: boolean;
  dg1HashOverride?: Uint8Array;
  dg2HashOverride?: Uint8Array;
}): Promise<Uint8Array> {
  const [dg1Digest, dg2Digest] = await Promise.all([
    crypto.subtle.digest(algorithm, bufferBytes(dg1)),
    crypto.subtle.digest(algorithm, bufferBytes(dg2)),
  ]);
  const dataGroupHashes: Sequence[] = [];

  if (includeDg1Hash) {
    dataGroupHashes.push(
      new Sequence({
        value: [
          new Integer({
            value: 1,
          }),
          new OctetString({
            valueHex: bufferBytes(dg1HashOverride ?? new Uint8Array(dg1Digest)),
          }),
        ],
      })
    );
  }

  if (includeDg2Hash) {
    dataGroupHashes.push(
      new Sequence({
        value: [
          new Integer({
            value: 2,
          }),
          new OctetString({
            valueHex: bufferBytes(dg2HashOverride ?? new Uint8Array(dg2Digest)),
          }),
        ],
      })
    );
  }

  const ldsSecurityObject = new Sequence({
    value: [
      new Integer({
        value: 0,
      }),
      createAlgorithmIdentifier(algorithm).toSchema(),
      new Sequence({
        value: dataGroupHashes,
      }),
    ],
  });

  const signedData = new SignedData({
    version: 1,
    digestAlgorithms: [createAlgorithmIdentifier(algorithm)],
    encapContentInfo: new EncapsulatedContentInfo({
      eContentType: ICAO_LDS_SECURITY_OBJECT_OID,
      eContent: new OctetString({
        valueHex: ldsSecurityObject.toBER(false),
      }),
    }),
    signerInfos: [],
  });

  const contentInfo = new ContentInfo({
    contentType: CMS_SIGNED_DATA_OID,
    content: signedData.toSchema(),
  });

  return new Uint8Array(contentInfo.toSchema().toBER(false));
}

export async function createSodArtifact({
  algorithm = "SHA-256",
  dg1,
  dg1HashOverride,
  dg2,
  dg2HashOverride,
  includeDg1Hash = true,
  includeDg2Hash = true,
  includeEmbeddedSignerCertificate = true,
  includeSignedAttributes = false,
  signerIdentifier = "issuer_and_serial",
  signerSubjectKeyIdentifierHex,
  signatureHashAlgorithm,
  signerCertificate,
  signerPrivateKey,
}: {
  dg1: Uint8Array;
  dg2: Uint8Array;
  algorithm?: SupportedHashAlgorithm;
  includeDg1Hash?: boolean;
  includeDg2Hash?: boolean;
  dg1HashOverride?: Uint8Array;
  dg2HashOverride?: Uint8Array;
  includeEmbeddedSignerCertificate?: boolean;
  includeSignedAttributes?: boolean;
  signerIdentifier?: "issuer_and_serial" | "subject_key_identifier";
  signerSubjectKeyIdentifierHex?: string;
  signatureHashAlgorithm?: SupportedHashAlgorithm;
  signerCertificate?: Certificate;
  signerPrivateKey?: CryptoKey;
}): Promise<Uint8Array> {
  const chain =
    signerCertificate && signerPrivateKey
      ? null
      : await loadDefaultPassiveAuthChain();
  const resolvedSignerCertificate = signerCertificate ?? chain?.dsc.cert;
  const resolvedSignerPrivateKey =
    signerPrivateKey ?? chain?.dsc.keyPair.privateKey;

  if (!(resolvedSignerCertificate && resolvedSignerPrivateKey)) {
    throw new Error("passive_auth_signer_required");
  }

  const contentInfoBytes = await createUnsignedSodArtifact({
    algorithm,
    dg1,
    dg1HashOverride,
    dg2,
    dg2HashOverride,
    includeDg1Hash,
    includeDg2Hash,
  });
  const contentInfo = new ContentInfo({
    schema: fromBER(bufferBytes(contentInfoBytes)).result,
  });
  const signedData = new SignedData({
    schema: contentInfo.content,
  });
  const resolvedSignatureHashAlgorithm = signatureHashAlgorithm ?? algorithm;
  const signerSid =
    signerIdentifier === "subject_key_identifier"
      ? new Primitive({
          idBlock: {
            tagClass: 3,
            tagNumber: 0,
          },
          valueHex: hexBytes(
            signerSubjectKeyIdentifierHex ??
              (await subjectKeyIdentifierHex(resolvedSignerCertificate)) ??
              (() => {
                throw new Error("passive_auth_signer_ski_missing");
              })()
          ).slice(0),
        })
      : new IssuerAndSerialNumber({
          issuer: resolvedSignerCertificate.issuer,
          serialNumber: resolvedSignerCertificate.serialNumber,
        });
  const signerInfoParameters: ConstructorParameters<typeof SignerInfo>[0] = {
    sid: signerSid,
    version: signerIdentifier === "subject_key_identifier" ? 3 : 1,
  };

  if (includeSignedAttributes) {
    signerInfoParameters.signedAttrs = new SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new Attribute({
          type: "1.2.840.113549.1.9.3",
          values: [
            new ObjectIdentifier({
              value: ICAO_LDS_SECURITY_OBJECT_OID,
            }),
          ],
        }),
        new Attribute({
          type: "1.2.840.113549.1.9.4",
          values: [
            new OctetString({
              valueHex: (
                await crypto.subtle.digest(
                  resolvedSignatureHashAlgorithm,
                  bufferBytes(
                    new Uint8Array(
                      signedData.encapContentInfo.eContent?.getValue() ?? []
                    )
                  )
                )
              ).slice(0),
            }),
          ],
        }),
      ],
    });
  }

  signedData.signerInfos = [new SignerInfo(signerInfoParameters)];
  signedData.certificates = includeEmbeddedSignerCertificate
    ? [resolvedSignerCertificate]
    : [];
  await signedData.sign(
    resolvedSignerPrivateKey,
    0,
    resolvedSignatureHashAlgorithm
  );

  return new Uint8Array(
    new ContentInfo({
      content: signedData.toSchema(),
      contentType: CMS_SIGNED_DATA_OID,
    })
      .toSchema()
      .toBER(false)
  );
}

export async function createValidNfcArtifacts({
  dg1 = createDg1Artifact(createTd3MrzText()),
  dg2,
  dg2ImageData,
  dg2ImageFormat = "jpeg",
}: {
  dg1?: Uint8Array;
  dg2?: Uint8Array;
  dg2ImageData?: Uint8Array;
  dg2ImageFormat?: SupportedImageFormat;
} = {}): Promise<{
  dg1: Uint8Array;
  dg2: Uint8Array;
  sod: Uint8Array;
  trustBundle: PassiveAuthTrustBundle;
}> {
  const resolvedDg2 =
    dg2 ??
    createDg2Artifact({
      imageData: dg2ImageData ?? (await createValidationPortraitJpeg()),
      imageFormat: dg2ImageFormat,
    });
  const chain = await loadDefaultPassiveAuthChain();

  return {
    dg1,
    dg2: resolvedDg2,
    sod: await createSodArtifact({
      dg1,
      dg2: resolvedDg2,
    }),
    trustBundle: chain.trustBundle,
  };
}

export async function createInvalidAuthenticityArtifacts(): Promise<{
  dg1: Uint8Array;
  dg2: Uint8Array;
  sod: Uint8Array;
}> {
  const dg1 = createDg1Artifact(createTd3MrzText());
  const dg2 = createDg2Artifact({
    imageData: await loadVerifyFixtureBytes("icon.jpg"),
    imageFormat: "jpeg",
  });

  return {
    dg1,
    dg2,
    sod: await createSodArtifact({
      dg1,
      dg2,
      dg1HashOverride: new Uint8Array(32).fill(0),
      dg2HashOverride: new Uint8Array(32).fill(0),
    }),
  };
}
