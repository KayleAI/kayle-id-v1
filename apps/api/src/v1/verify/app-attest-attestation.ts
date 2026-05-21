import { Certificate, CertificateChainValidationEngine } from "pkijs";
import {
	APP_ATTEST_FMT,
	AUTH_DATA_AAGUID_OFFSET,
	AUTH_DATA_CRED_ID_LEN_OFFSET,
	AUTH_DATA_CRED_ID_OFFSET,
	AUTH_DATA_FLAGS_OFFSET,
	AUTH_DATA_RP_ID_HASH_OFFSET,
	computeAppAttestRpIdHash,
	expectedAaguidForEnvironment,
	readAuthDataCounter,
	readAuthDataCredentialId,
} from "./app-attest-auth-data";
import { concat, sha256, toAlignedArrayBuffer } from "./app-attest-bytes";
import { type AttestationCbor, decodeAttestationCbor } from "./app-attest-cbor";
import {
	exportSubjectPublicKey,
	extractAppleNonceExtension,
	parseRootCertFromPem,
} from "./app-attest-certificate";
import { parseCoseEc2Key } from "./app-attest-cose";
import { getAppAttestRootCertPem } from "./app-attest-trust";
import type {
	AppAttestEnvironment,
	AttestationVerificationResult,
} from "./app-attest-types";
import { ensurePkijsEngine } from "./pkd-trust";
import { bytesEqual } from "./sod-asn1-utils";

export async function verifyAttestation({
	keyId,
	attestationCbor,
	clientDataHash,
	environment,
}: {
	keyId: Uint8Array;
	attestationCbor: Uint8Array;
	clientDataHash: Uint8Array;
	environment: AppAttestEnvironment;
}): Promise<AttestationVerificationResult> {
	let decoded: AttestationCbor;
	try {
		decoded = decodeAttestationCbor(attestationCbor);
	} catch (error) {
		return {
			ok: false,
			reason: "cbor_decode_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	if (decoded.fmt !== APP_ATTEST_FMT) {
		return { ok: false, reason: "fmt_unexpected", detail: decoded.fmt };
	}

	if (decoded.attStmt.x5c.length === 0) {
		return { ok: false, reason: "x5c_missing" };
	}

	if (decoded.attStmt.receipt.length === 0) {
		return { ok: false, reason: "receipt_missing" };
	}

	ensurePkijsEngine();

	let credCert: Certificate;
	let chain: Certificate[];
	try {
		chain = decoded.attStmt.x5c.map((der) =>
			Certificate.fromBER(toAlignedArrayBuffer(der)),
		);
		credCert = chain[0] as Certificate;
	} catch (error) {
		return {
			ok: false,
			reason: "cert_parse_failed",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	const rootCert = parseRootCertFromPem(getAppAttestRootCertPem());
	const chainValid = await new CertificateChainValidationEngine({
		certs: chain,
		trustedCerts: [rootCert],
	}).verify();

	if (!chainValid.result) {
		return {
			ok: false,
			reason: "cert_chain_invalid",
			detail: chainValid.resultMessage,
		};
	}

	const authData = decoded.authData;
	if (authData.length < AUTH_DATA_CRED_ID_OFFSET) {
		return { ok: false, reason: "auth_data_truncated" };
	}

	const expectedRpIdHash = await computeAppAttestRpIdHash();
	const rpIdHash = authData.slice(
		AUTH_DATA_RP_ID_HASH_OFFSET,
		AUTH_DATA_FLAGS_OFFSET,
	);
	if (!bytesEqual(rpIdHash, expectedRpIdHash)) {
		return { ok: false, reason: "rp_id_hash_mismatch" };
	}

	const counter = readAuthDataCounter(authData);
	if (counter !== 0) {
		return {
			ok: false,
			reason: "counter_not_zero",
			detail: String(counter),
		};
	}

	const aaguid = authData.slice(
		AUTH_DATA_AAGUID_OFFSET,
		AUTH_DATA_CRED_ID_LEN_OFFSET,
	);
	if (!bytesEqual(aaguid, expectedAaguidForEnvironment(environment))) {
		return { ok: false, reason: "aaguid_mismatch" };
	}

	const credential = readAuthDataCredentialId(authData);
	if (!credential.ok) {
		return { ok: false, reason: "auth_data_truncated" };
	}

	const subjectPublicKeyDer = exportSubjectPublicKey(credCert);
	const credCertPubKeyHash = await sha256(subjectPublicKeyDer);

	if (!bytesEqual(credential.credentialId, credCertPubKeyHash)) {
		return { ok: false, reason: "credential_id_mismatch" };
	}
	if (!bytesEqual(keyId, credCertPubKeyHash)) {
		return { ok: false, reason: "key_id_mismatch" };
	}

	const expectedNonce = await sha256(concat(authData, clientDataHash));
	const credCertNonce = extractAppleNonceExtension(credCert);
	if (!credCertNonce) {
		return { ok: false, reason: "nonce_extension_missing" };
	}
	if (!bytesEqual(credCertNonce, expectedNonce)) {
		return { ok: false, reason: "nonce_mismatch" };
	}

	let cosePublicKey: Uint8Array;
	try {
		cosePublicKey = authData.slice(credential.endOffset);
		parseCoseEc2Key(cosePublicKey);
	} catch (error) {
		return {
			ok: false,
			reason: "cose_public_key_invalid",
			detail: error instanceof Error ? error.message : undefined,
		};
	}

	return {
		ok: true,
		publicKeyCose: cosePublicKey,
		receipt: decoded.attStmt.receipt,
		counter,
	};
}
