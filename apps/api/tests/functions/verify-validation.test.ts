import { describe, expect, test } from "bun:test";
import { Integer, ObjectIdentifier, OctetString, Sequence } from "asn1js";
import {
	createPkdCrlRecord,
	hydratePkdTrustBundle,
} from "@/v1/verify/pkd-trust";
import {
	extractDg2FaceImage,
	validateAuthenticity,
} from "@/v1/verify/validation";
import {
	createCertificateRevocationListArtifact,
	createDg2Artifact,
	createMalformedDg2Artifact,
	createPassiveAuthTestChain,
	createSodArtifact,
	createValidNfcArtifacts,
	loadVerifyFixtureBytes,
	TEST_PASSIVE_AUTH_CHECK_DATE,
} from "../helpers/verify-artifacts";

type ExplicitEcCurveTestCase = {
	curveName: "P-256" | "P-384" | "P-521";
	parameters: () => Sequence;
};

type PassiveAuthTestChainValue = Awaited<
	ReturnType<typeof createPassiveAuthTestChain>
>;
type PassiveAuthTrustBundleRaw =
	PassiveAuthTestChainValue["trustBundle"]["raw"];

function wrapSodAsEfSod(contentInfo: Uint8Array): Uint8Array {
	const length = contentInfo.length;

	if (length < 0x80) {
		return Uint8Array.from([0x77, length, ...contentInfo]);
	}

	const lengthBytes: number[] = [];
	let remaining = length;

	while (remaining > 0) {
		lengthBytes.unshift(remaining % 0x1_00);
		remaining = Math.floor(remaining / 0x1_00);
	}

	return Uint8Array.from([
		0x77,
		0x80 + lengthBytes.length,
		...lengthBytes,
		...contentInfo,
	]);
}

function hexBuffer(hex: string): ArrayBuffer {
	const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
	return bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	);
}

function explicitP256AlgorithmParameters(): Sequence {
	return new Sequence({
		value: [
			new Integer({ value: 1 }),
			new Sequence({
				value: [
					new ObjectIdentifier({ value: "1.2.840.10045.1.1" }),
					new Integer({
						valueHex: hexBuffer(
							"ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
						),
					}),
				],
			}),
			new Sequence({
				value: [
					new OctetString({
						valueHex: hexBuffer(
							"ffffffff00000001000000000000000000000000fffffffffffffffffffffffc",
						),
					}),
					new OctetString({
						valueHex: hexBuffer(
							"5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b",
						),
					}),
				],
			}),
			new OctetString({
				valueHex: hexBuffer(
					"046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
				),
			}),
			new Integer({
				valueHex: hexBuffer(
					"ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
				),
			}),
			new Integer({ value: 1 }),
		],
	});
}

function explicitP384AlgorithmParameters(): Sequence {
	return new Sequence({
		value: [
			new Integer({ value: 1 }),
			new Sequence({
				value: [
					new ObjectIdentifier({ value: "1.2.840.10045.1.1" }),
					new Integer({
						valueHex: hexBuffer(
							"fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff",
						),
					}),
				],
			}),
			new Sequence({
				value: [
					new OctetString({
						valueHex: hexBuffer(
							"fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc",
						),
					}),
					new OctetString({
						valueHex: hexBuffer(
							"b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef",
						),
					}),
				],
			}),
			new OctetString({
				valueHex: hexBuffer(
					"04aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab73617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f",
				),
			}),
			new Integer({
				valueHex: hexBuffer(
					"ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973",
				),
			}),
			new Integer({ value: 1 }),
		],
	});
}

function explicitP521AlgorithmParameters(): Sequence {
	return new Sequence({
		value: [
			new Integer({ value: 1 }),
			new Sequence({
				value: [
					new ObjectIdentifier({ value: "1.2.840.10045.1.1" }),
					new Integer({
						valueHex: hexBuffer(
							"01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
						),
					}),
				],
			}),
			new Sequence({
				value: [
					new OctetString({
						valueHex: hexBuffer(
							"01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc",
						),
					}),
					new OctetString({
						valueHex: hexBuffer(
							"0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00",
						),
					}),
				],
			}),
			new OctetString({
				valueHex: hexBuffer(
					"0400c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650",
				),
			}),
			new Integer({
				valueHex: hexBuffer(
					"01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409",
				),
			}),
			new Integer({ value: 1 }),
		],
	});
}

const EXPLICIT_EC_CURVE_CASES: ExplicitEcCurveTestCase[] = [
	{
		curveName: "P-256",
		parameters: explicitP256AlgorithmParameters,
	},
	{
		curveName: "P-384",
		parameters: explicitP384AlgorithmParameters,
	},
	{
		curveName: "P-521",
		parameters: explicitP521AlgorithmParameters,
	},
] as const;

function createTrustBundleWithCrlRecords({
	chain,
	crls,
}: {
	chain: PassiveAuthTestChainValue;
	crls: Awaited<ReturnType<typeof createCertificateRevocationListArtifact>>[];
}) {
	const [sourceRecord] = chain.trustBundle.raw.crls;

	return hydratePkdTrustBundle({
		...chain.trustBundle.raw,
		counts: {
			...chain.trustBundle.raw.counts,
			crls: crls.length,
		},
		crls: crls.map(({ crl, derBytes }) =>
			createPkdCrlRecord({
				crl,
				derBytes,
				sourceCountryCode: sourceRecord?.sourceCountryCode ?? "UT",
				sourceDn:
					sourceRecord?.sourceDn ?? "cn=Kayle Test PKD Source,o=Kayle Test",
			}),
		),
	});
}

function createTrustBundleWithDscRecords({
	chain,
	dscRecords,
}: {
	chain: PassiveAuthTestChainValue;
	dscRecords: PassiveAuthTrustBundleRaw["dscs"];
}) {
	return hydratePkdTrustBundle({
		...chain.trustBundle.raw,
		counts: {
			...chain.trustBundle.raw.counts,
			dscs: dscRecords.length,
		},
		dscs: dscRecords,
	});
}

describe("verify validation engine", () => {
	test("passes trusted passive authentication for a valid chain", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.algorithm).toBe("SHA-256");
			expect(result.crlStatus).toBe("verified_not_revoked");
			expect(result.revocationOutcome).toBe("verified_not_revoked");
			expect(result.signerSource).toBe("sod");
			expect(result.source).toBe("cms_signed_data");
		}
	});

	test("passes trusted passive authentication for RSA signed attributes", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain({
			cscaKeyType: "ec",
			dscKeyType: "rsa",
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				algorithm: "SHA-512",
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeSignedAttributes: true,
				signatureHashAlgorithm: "SHA-256",
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle: chain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.algorithm).toBe("SHA-512");
			expect(result.crlStatus).toBe("verified_not_revoked");
			expect(result.revocationOutcome).toBe("verified_not_revoked");
			expect(result.signerSource).toBe("sod");
			expect(result.source).toBe("cms_signed_data");
		}
	});

	test("fails passive authentication for an untrusted chain", async () => {
		const artifacts = await createValidNfcArtifacts();
		const unrelatedChain = await createPassiveAuthTestChain({
			cscaCommonName: "Other Test CSCA",
		});

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			trustBundle: unrelatedChain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("chain_untrusted");
			expect(result.crlStatus).toBe("not_checked");
			expect(result.revocationOutcome).toBeNull();
			expect(result.signerSource).toBe("sod");
		}
	});

	test("fails passive authentication for an expired DSC certificate", async () => {
		const artifacts = await createValidNfcArtifacts();
		const expiredChain = await createPassiveAuthTestChain({
			dscNotAfter: new Date("2024-12-31T00:00:00.000Z"),
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: expiredChain.dsc.cert,
				signerPrivateKey: expiredChain.dsc.keyPair.privateKey,
			}),
			trustBundle: expiredChain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("signer_certificate_expired");
			expect(result.crlStatus).toBe("not_checked");
			expect(result.revocationOutcome).toBeNull();
			expect(result.signerSource).toBe("sod");
		}
	});

	test("fails passive authentication for an invalid DSC certificate", async () => {
		const artifacts = await createValidNfcArtifacts();
		const invalidChain = await createPassiveAuthTestChain({
			invalidDscSignature: true,
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: invalidChain.dsc.cert,
				signerPrivateKey: invalidChain.dsc.keyPair.privateKey,
			}),
			trustBundle: invalidChain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("signer_certificate_invalid");
			expect(result.crlStatus).toBe("not_checked");
			expect(result.revocationOutcome).toBeNull();
			expect(result.signerSource).toBe("sod");
		}
	});

	test("passes passive authentication when the signer certificate is resolved from the trust bundle", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle: chain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("verified_not_revoked");
			expect(result.revocationOutcome).toBe("verified_not_revoked");
			expect(result.signerSource).toBe("bundle");
		}
	});

	test("passes passive authentication when an SKI signer is resolved from the trust bundle", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: chain.dsc.cert,
				signerIdentifier: "subject_key_identifier",
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle: chain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("verified_not_revoked");
			expect(result.revocationOutcome).toBe("verified_not_revoked");
			expect(result.signerSource).toBe("bundle");
		}
	});

	test("fails passive authentication when an SKI signer points to a bundle DSC with no SKI extension", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain({
			includeDscSubjectKeyIdentifier: false,
		});
		const signerSubjectKeyIdentifierHex = Buffer.from(
			await chain.dsc.cert.getKeyHash("SHA-1"),
		).toString("hex");

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: chain.dsc.cert,
				signerIdentifier: "subject_key_identifier",
				signerPrivateKey: chain.dsc.keyPair.privateKey,
				signerSubjectKeyIdentifierHex,
			}),
			trustBundle: chain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("missing_signer_certificate");
			expect(result.signerSource).toBeNull();
		}
	});

	test("fails passive authentication when an SKI signer certificate is missing from the trust bundle", async () => {
		const artifacts = await createValidNfcArtifacts();
		const signerChain = await createPassiveAuthTestChain();
		const unrelatedChain = await createPassiveAuthTestChain({
			cscaCommonName: "Other Test CSCA",
			dscCommonName: "Other Test DSC",
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: signerChain.dsc.cert,
				signerIdentifier: "subject_key_identifier",
				signerPrivateKey: signerChain.dsc.keyPair.privateKey,
			}),
			trustBundle: unrelatedChain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("missing_signer_certificate");
			expect(result.signerSource).toBeNull();
		}
	});

	test("passes passive authentication when multiple bundle DSCs share an SKI and only a later candidate verifies", async () => {
		const artifacts = await createValidNfcArtifacts();
		const signerChain = await createPassiveAuthTestChain();
		const wrongChain = await createPassiveAuthTestChain({
			cscaCommonName: "Wrong SKI CSCA",
			dscCommonName: "Wrong SKI DSC",
		});
		const sharedSkiHex = signerChain.trustBundle.raw.dscs[0]?.skiHex;

		if (!sharedSkiHex) {
			throw new Error("Expected signer DSC SKI to be present");
		}

		const trustBundle = createTrustBundleWithDscRecords({
			chain: signerChain,
			dscRecords: [
				{
					...wrongChain.trustBundle.raw.dscs[0],
					skiHex: sharedSkiHex,
				},
				signerChain.trustBundle.raw.dscs[0],
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: signerChain.dsc.cert,
				signerIdentifier: "subject_key_identifier",
				signerPrivateKey: signerChain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.signerSource).toBe("bundle");
		}
	});

	test("fails passive authentication when multiple bundle DSCs share an SKI and none validate", async () => {
		const artifacts = await createValidNfcArtifacts();
		const signerChain = await createPassiveAuthTestChain();
		const wrongChain = await createPassiveAuthTestChain({
			cscaCommonName: "Wrong SKI CSCA",
			dscCommonName: "Wrong SKI DSC",
		});
		const secondWrongChain = await createPassiveAuthTestChain({
			cscaCommonName: "Wrong SKI CSCA 2",
			dscCommonName: "Wrong SKI DSC 2",
		});
		const sharedSkiHex = signerChain.trustBundle.raw.dscs[0]?.skiHex;

		if (!sharedSkiHex) {
			throw new Error("Expected signer DSC SKI to be present");
		}

		const trustBundle = createTrustBundleWithDscRecords({
			chain: signerChain,
			dscRecords: [
				{
					...wrongChain.trustBundle.raw.dscs[0],
					skiHex: sharedSkiHex,
				},
				{
					...secondWrongChain.trustBundle.raw.dscs[0],
					skiHex: sharedSkiHex,
				},
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: signerChain.dsc.cert,
				signerIdentifier: "subject_key_identifier",
				signerPrivateKey: signerChain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("cms_signature_invalid");
			expect(result.signerSource).toBe("bundle");
		}
	});

	test("passes passive authentication when an EC bundle signer has wrapped curve parameters", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain({
			cscaKeyType: "ec",
			dscKeyType: "ec",
		});
		const algorithmParams =
			chain.dsc.cert.subjectPublicKeyInfo.algorithm.algorithmParams;

		expect(algorithmParams).toBeInstanceOf(ObjectIdentifier);

		if (algorithmParams instanceof ObjectIdentifier) {
			chain.dsc.cert.subjectPublicKeyInfo.algorithm.algorithmParams =
				new OctetString({
					valueHex: algorithmParams.toBER(false),
				});
		}

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				includeEmbeddedSignerCertificate: false,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle: chain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.signerSource).toBe("bundle");
		}
	});

	for (const { curveName, parameters } of EXPLICIT_EC_CURVE_CASES) {
		test(`passes trusted passive authentication for an EC signer with explicit ${curveName} curve parameters`, async () => {
			const artifacts = await createValidNfcArtifacts();
			const chain = await createPassiveAuthTestChain({
				cscaKeyType: "ec",
				dscEcNamedCurve: curveName,
				dscKeyType: "ec",
			});

			chain.dsc.cert.subjectPublicKeyInfo.algorithm.algorithmParams =
				parameters();

			const result = await validateAuthenticity({
				checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				sod: await createSodArtifact({
					dg1: artifacts.dg1,
					dg2: artifacts.dg2,
					signerCertificate: chain.dsc.cert,
					signerPrivateKey: chain.dsc.keyPair.privateKey,
				}),
				trustBundle: chain.trustBundle,
			});

			expect(result.ok).toBeTrue();
			if (result.ok) {
				expect(result.signerSource).toBe("sod");
			}
		});

		test(`passes trusted passive authentication when the issuing CSCA has explicit ${curveName} curve parameters`, async () => {
			const artifacts = await createValidNfcArtifacts();
			const chain = await createPassiveAuthTestChain({
				cscaEcNamedCurve: curveName,
				cscaKeyType: "ec",
				dscKeyType: "ec",
			});

			for (const candidates of chain.trustBundle.cscasBySubjectKey.values()) {
				for (const candidate of candidates) {
					candidate.cert.subjectPublicKeyInfo.algorithm.algorithmParams =
						parameters();
				}
			}

			const result = await validateAuthenticity({
				checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				sod: await createSodArtifact({
					dg1: artifacts.dg1,
					dg2: artifacts.dg2,
					signerCertificate: chain.dsc.cert,
					signerPrivateKey: chain.dsc.keyPair.privateKey,
				}),
				trustBundle: chain.trustBundle,
			});

			expect(result.ok).toBeTrue();
			if (result.ok) {
				expect(result.crlStatus).toBe("verified_not_revoked");
				expect(result.signerSource).toBe("sod");
			}

			for (const candidates of chain.trustBundle.cscasBySubjectKey.values()) {
				for (const candidate of candidates) {
					expect(
						candidate.cert.subjectPublicKeyInfo.algorithm.algorithmParams,
					).toBeInstanceOf(Sequence);
				}
			}
		});
	}

	test("fails passive authentication when the signer certificate is explicitly revoked", async () => {
		const artifacts = await createValidNfcArtifacts();
		const revokedChain = await createPassiveAuthTestChain({
			revokeDsc: true,
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: revokedChain.dsc.cert,
				signerPrivateKey: revokedChain.dsc.keyPair.privateKey,
			}),
			trustBundle: revokedChain.trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.crlStatus).toBe("revoked");
			expect(result.reason).toBe("crl_revoked");
			expect(result.revocationOutcome).toBe("revoked");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("passes passive authentication with revocation_unknown when CRL coverage is missing", async () => {
		const artifacts = await createValidNfcArtifacts();
		const noCrlChain = await createPassiveAuthTestChain({
			includeCrl: false,
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: noCrlChain.dsc.cert,
				signerPrivateKey: noCrlChain.dsc.keyPair.privateKey,
			}),
			trustBundle: noCrlChain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("missing");
			expect(result.revocationOutcome).toBe("revocation_unknown");
			expect(result.signerSource).toBe("sod");
			expect(result.source).toBe("cms_signed_data");
		}
	});

	test("passes passive authentication with revocation_unknown when CRL coverage is stale", async () => {
		const artifacts = await createValidNfcArtifacts();
		const staleCrlChain = await createPassiveAuthTestChain({
			staleCrl: true,
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: staleCrlChain.dsc.cert,
				signerPrivateKey: staleCrlChain.dsc.keyPair.privateKey,
			}),
			trustBundle: staleCrlChain.trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("stale");
			expect(result.revocationOutcome).toBe("revocation_unknown");
			expect(result.signerSource).toBe("sod");
			expect(result.source).toBe("cms_signed_data");
		}
	});

	test("fails passive authentication when a newer current CRL revokes the DSC", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();
		const trustBundle = await createTrustBundleWithCrlRecords({
			chain,
			crls: [
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-02-01T00:00:00.000Z"),
					revokedCertificates: [],
					thisUpdate: new Date("2024-11-01T00:00:00.000Z"),
				}),
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-04-01T00:00:00.000Z"),
					revokedCertificates: [chain.dsc.cert],
					thisUpdate: new Date("2025-01-10T00:00:00.000Z"),
				}),
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.crlStatus).toBe("revoked");
			expect(result.reason).toBe("crl_revoked");
			expect(result.revocationOutcome).toBe("revoked");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("fails passive authentication when any current verified CRL revokes the DSC", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();
		const trustBundle = await createTrustBundleWithCrlRecords({
			chain,
			crls: [
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-02-01T00:00:00.000Z"),
					revokedCertificates: [chain.dsc.cert],
					thisUpdate: new Date("2024-11-01T00:00:00.000Z"),
				}),
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-04-01T00:00:00.000Z"),
					revokedCertificates: [],
					thisUpdate: new Date("2025-01-10T00:00:00.000Z"),
				}),
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.crlStatus).toBe("revoked");
			expect(result.reason).toBe("crl_revoked");
			expect(result.revocationOutcome).toBe("revoked");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("fails passive authentication when a verified revoking CRL is accompanied by an unverifiable current CRL", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();
		const invalidSignerChain = await createPassiveAuthTestChain();
		const trustBundle = await createTrustBundleWithCrlRecords({
			chain,
			crls: [
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: invalidSignerChain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-02-01T00:00:00.000Z"),
					revokedCertificates: [],
					thisUpdate: new Date("2024-11-01T00:00:00.000Z"),
				}),
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-04-01T00:00:00.000Z"),
					revokedCertificates: [chain.dsc.cert],
					thisUpdate: new Date("2025-01-10T00:00:00.000Z"),
				}),
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.crlStatus).toBe("revoked");
			expect(result.reason).toBe("crl_revoked");
			expect(result.revocationOutcome).toBe("revoked");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("passes passive authentication with revocation_unknown when only stale verified CRLs are available", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();
		const trustBundle = await createTrustBundleWithCrlRecords({
			chain,
			crls: [
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: chain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-01-01T00:00:00.000Z"),
					revokedCertificates: [],
					thisUpdate: new Date("2024-12-01T00:00:00.000Z"),
				}),
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("stale");
			expect(result.revocationOutcome).toBe("revocation_unknown");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("passes passive authentication with revocation_unknown when only missing or unverifiable CRLs are available", async () => {
		const artifacts = await createValidNfcArtifacts();
		const chain = await createPassiveAuthTestChain();
		const invalidSignerChain = await createPassiveAuthTestChain();
		const trustBundle = await createTrustBundleWithCrlRecords({
			chain,
			crls: [
				await createCertificateRevocationListArtifact({
					issuer: chain.csca.cert,
					issuerPrivateKey: invalidSignerChain.csca.keyPair.privateKey,
					nextUpdate: new Date("2025-06-01T00:00:00.000Z"),
					revokedCertificates: [],
					thisUpdate: new Date("2025-03-01T00:00:00.000Z"),
				}),
			],
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1: artifacts.dg1,
			dg2: artifacts.dg2,
			sod: await createSodArtifact({
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
				signerCertificate: chain.dsc.cert,
				signerPrivateKey: chain.dsc.keyPair.privateKey,
			}),
			trustBundle,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.crlStatus).toBe("missing");
			expect(result.revocationOutcome).toBe("revocation_unknown");
			expect(result.signerSource).toBe("sod");
		}
	});

	test("fails authenticity when DG15 bytes are uploaded without a matching SOD hash entry", async () => {
		const artifacts = await createValidNfcArtifacts();
		const dg15 = Uint8Array.of(0x6f, 0x03, 0x01, 0x02, 0x03);

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg15,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("sod_undeclared_dg_supplied");
		}
	});

	test("fails authenticity when SOD declares DG15 hash but client omits DG15 bytes", async () => {
		const artifacts = await createValidNfcArtifacts();
		const dg15 = Uint8Array.of(0x6f, 0x03, 0x01, 0x02, 0x03);
		const dg15Hash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", dg15),
		);

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			sod: await createSodArtifact({
				additionalDataGroupHashes: [{ dataGroupNumber: 15, hash: dg15Hash }],
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
			}),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("sod_declared_dg_missing");
		}
	});

	test("fails authenticity when SOD declares DG14 hash but client omits DG14 bytes", async () => {
		const artifacts = await createValidNfcArtifacts();
		const dg14 = Uint8Array.of(0x6e, 0x03, 0x0a, 0x0b, 0x0c);
		const dg14Hash = new Uint8Array(
			await crypto.subtle.digest("SHA-256", dg14),
		);

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			sod: await createSodArtifact({
				additionalDataGroupHashes: [{ dataGroupNumber: 14, hash: dg14Hash }],
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
			}),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("sod_declared_dg_missing");
		}
	});

	test("passes authenticity with sodDeclares={dg14:false,dg15:false} when SOD declares neither", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.sodDeclares.dg14).toBeFalse();
			expect(result.sodDeclares.dg15).toBeFalse();
		}
	});

	test("passes authenticity with sodDeclares={dg14:true,dg15:true} when SOD declares both and client uploads matching bytes", async () => {
		const artifacts = await createValidNfcArtifacts();
		const dg14 = Uint8Array.of(0x6e, 0x03, 0x0a, 0x0b, 0x0c);
		const dg15 = Uint8Array.of(0x6f, 0x03, 0x01, 0x02, 0x03);
		const [dg14Hash, dg15Hash] = await Promise.all([
			crypto.subtle.digest("SHA-256", dg14),
			crypto.subtle.digest("SHA-256", dg15),
		]);

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg14,
			dg15,
			sod: await createSodArtifact({
				additionalDataGroupHashes: [
					{ dataGroupNumber: 14, hash: new Uint8Array(dg14Hash) },
					{ dataGroupNumber: 15, hash: new Uint8Array(dg15Hash) },
				],
				dg1: artifacts.dg1,
				dg2: artifacts.dg2,
			}),
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.sodDeclares.dg14).toBeTrue();
			expect(result.sodDeclares.dg15).toBeTrue();
		}
	});

	test("fails authenticity on digest mismatch", async () => {
		const dg1 = new TextEncoder().encode(
			"P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
		);
		const dg2 = createDg2Artifact({
			imageData: await loadVerifyFixtureBytes("icon.jpg"),
			imageFormat: "jpeg",
		});
		const sod = await createSodArtifact({
			dg1,
			dg2,
			dg1HashOverride: new Uint8Array(32).fill(0),
			dg2HashOverride: new Uint8Array(32).fill(0),
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1,
			dg2,
			sod,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("dg_hash_mismatch");
		}
	});

	test("fails authenticity when DG2 hash is missing from the security object", async () => {
		const dg1 = new TextEncoder().encode(
			"P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
		);
		const dg2 = createDg2Artifact({
			imageData: await loadVerifyFixtureBytes("icon.jpg"),
			imageFormat: "jpeg",
		});
		const sod = await createSodArtifact({
			dg1,
			dg2,
			includeDg2Hash: false,
		});

		const result = await validateAuthenticity({
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			dg1,
			dg2,
			sod,
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("required_dg_hash_missing");
		}
	});

	test("fails authenticity on malformed SOD payloads", async () => {
		const result = await validateAuthenticity({
			dg1: new Uint8Array([0x01, 0x02]),
			dg2: new Uint8Array([0x03, 0x04]),
			sod: new Uint8Array([0x00, 0x01, 0x02]),
		});

		expect(result.ok).toBeFalse();
		if (!result.ok) {
			expect(result.reason).toBe("parse_failure");
		}
	});

	test("passes authenticity when SOD is wrapped as EF.SOD data group bytes", async () => {
		const artifacts = await createValidNfcArtifacts();

		const result = await validateAuthenticity({
			...artifacts,
			checkDate: TEST_PASSIVE_AUTH_CHECK_DATE,
			sod: wrapSodAsEfSod(artifacts.sod),
		});

		expect(result.ok).toBeTrue();
		if (result.ok) {
			expect(result.algorithm).toBe("SHA-256");
			expect(result.crlStatus).toBe("verified_not_revoked");
			expect(result.revocationOutcome).toBe("verified_not_revoked");
			expect(result.signerSource).toBe("sod");
			expect(result.source).toBe("cms_signed_data");
		}
	});

	test("extracts a JPEG portrait image from DG2", async () => {
		const jpegBytes = await loadVerifyFixtureBytes("icon.jpg");
		const dg2 = createDg2Artifact({
			imageData: jpegBytes,
			imageFormat: "jpeg",
		});

		const result = extractDg2FaceImage(dg2);

		expect(result.imageFormat).toBe("jpeg");
		expect(result.imageWidth).toBe(32);
		expect(result.imageHeight).toBe(32);
		expect(result.imageData.length).toBe(jpegBytes.length);
	});

	test("extracts a JPEG2000 portrait image from DG2", async () => {
		const jp2Bytes = await loadVerifyFixtureBytes("icon.jp2");
		const dg2 = createDg2Artifact({
			imageData: jp2Bytes,
			imageFormat: "jpeg2000",
		});

		const result = extractDg2FaceImage(dg2);

		expect(result.imageFormat).toBe("jpeg2000");
		expect(result.imageWidth).toBe(32);
		expect(result.imageHeight).toBe(32);
		expect(result.imageData.length).toBe(jp2Bytes.length);
	});

	test("extracts a JPEG portrait image from EF.DG2-wrapped payloads", async () => {
		const jpegBytes = await loadVerifyFixtureBytes("icon.jpg");
		const dg2 = createDg2Artifact({
			imageData: jpegBytes,
			imageFormat: "jpeg",
			wrapWithEfTag: true,
		});

		const result = extractDg2FaceImage(dg2);

		expect(result.imageFormat).toBe("jpeg");
		expect(result.imageWidth).toBe(32);
		expect(result.imageHeight).toBe(32);
		expect(result.imageData.length).toBe(jpegBytes.length);
	});

	test("rejects malformed DG2 payloads", () => {
		expect(() => extractDg2FaceImage(createMalformedDg2Artifact())).toThrow();
	});
});
