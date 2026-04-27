import {
	type AsnType,
	fromBER,
	Integer,
	ObjectIdentifier,
	OctetString,
	Sequence,
} from "asn1js";
import { Certificate, createECDSASignatureFromCMS, ECNamedCurves } from "pkijs";
import {
	bufferBytes,
	directObjectIdentifierValue,
	exactBytes,
	integerHexValue,
	octetStringHexValue,
	sequenceChildren,
} from "./sod-asn1-utils";
import {
	ECDSA_PUBLIC_KEY_OID,
	EXPLICIT_EC_CURVES,
	type ExplicitEcCurveParameters,
} from "./sod-constants";

function curveSizeBytes(namedCurve: string): number {
	const curve = ECNamedCurves.find(namedCurve);

	if (!curve) {
		throw new Error("cms_signature_curve_invalid");
	}

	return curve.size;
}

export function ecdsaSignatureBytes({
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
				curveSizeBytes(namedCurve),
			),
		),
	);
}

function explicitEcCurveParameters(
	algorithmParams: unknown,
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
	algorithmParams: unknown,
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
				(explicitCurve.cofactorHex ?? candidate.cofactorHex),
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

export function normalizedEcCertificatePublicKeyAlgorithm(
	cert: Certificate,
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

export function signerEcNamedCurve(signerCert: Certificate): string {
	const curve = resolveEcNamedCurve(
		signerCert.subjectPublicKeyInfo.algorithm.algorithmParams,
	);

	if (!curve) {
		throw new Error("cms_signature_curve_invalid");
	}

	return curve.name;
}
