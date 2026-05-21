import type { AlgorithmIdentifier, Certificate } from "pkijs";
import { verifySignatureWithCertificate } from "./cms-signature";
import {
	type PkdTrustBundle,
	type PkdTrustBundleCertificate,
	type PkdTrustBundleCrl,
	subjectKeyIdentifierHexOrKeyHash,
} from "./pkd-trust";
import { exactBytes } from "./sod-asn1-utils";
import { normalizedEcCertificatePublicKeyAlgorithm } from "./sod-ec-curves";
import type { PassiveAuthCrlStatus } from "./validation-types";

type CrlVerificationState = "current_verified" | "stale_verified";

function dedupeCrlEntries(
	entries: Iterable<PkdTrustBundleCrl>,
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
			candidate.crl.nextUpdate.value < checkDate,
	);
}

function crlIsNotYetUsable(
	candidate: PkdTrustBundleCrl,
	checkDate: Date,
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
		issuer.cert,
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
				signatureAlgorithm: candidate.crl
					.signatureAlgorithm as AlgorithmIdentifier,
				signatureBytes: exactBytes(
					candidate.crl.signatureValue.valueBlock.valueHexView,
				),
			});
		} catch {
			return false;
		}
	}
}

export async function evaluateCrlStatus({
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
		return "missing";
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
		? "stale"
		: "missing";
}
