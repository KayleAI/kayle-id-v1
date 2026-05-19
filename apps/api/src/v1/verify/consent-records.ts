import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import {
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import { isPublicVerifySessionHidden } from "./public-session-visibility";
import {
	computeShareContractHash,
	getShareFieldKeys,
	resolvePublicShareFields,
} from "./public-share-fields";
import { isTerminalSessionStatus } from "./status";

export const CONSENT_UI_VERSION = 1;
export const TERMS_VERSION = "2026-05-17";
export const PRIVACY_NOTICE_VERSION = "2026-05-17";

export type VerifyConsentInput = {
	biometricConsent: true;
	documentProcessingConsent: true;
	privacyNoticeAcknowledged: true;
	shareClaimsConsent: true;
	termsAcknowledged: true;
};

type ConsentError = {
	code: "CONSENT_REQUIRED" | "SESSION_EXPIRED" | "SESSION_NOT_FOUND";
	status: 400 | 404 | 410;
};

function getRequiredClaimKeys(shareFields: ShareFields): string[] {
	return getShareFieldKeys(shareFields).filter(
		(key) => shareFields[key]?.required === true,
	);
}

export async function recordVerifySessionConsent({
	env,
	input,
	now = new Date(),
	sessionId,
}: {
	env?: CloudflareBindings;
	input: VerifyConsentInput;
	now?: Date;
	sessionId: string;
}): Promise<
	| {
			ok: true;
			data: {
				consent_id: string;
				consented_at: string;
			};
	  }
	| {
			ok: false;
			error: ConsentError;
	  }
> {
	const [row] = await db
		.select({
			organizationName: auth_organizations.name,
			pendingDeletionAt: auth_organizations.pending_deletion_at,
			session: {
				cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
				cancelTokenHash: verification_sessions.cancelTokenHash,
				completedAt: verification_sessions.completedAt,
				contractVersion: verification_sessions.contractVersion,
				createdAt: verification_sessions.createdAt,
				expiresAt: verification_sessions.expiresAt,
				id: verification_sessions.id,
				isAgeOnly: verification_sessions.isAgeOnly,
				organizationId: verification_sessions.organizationId,
				redirectUrl: verification_sessions.redirectUrl,
				shareFields: verification_sessions.shareFields,
				status: verification_sessions.status,
				updatedAt: verification_sessions.updatedAt,
				webhookEndpointIds: verification_sessions.webhookEndpointIds,
			},
		})
		.from(verification_sessions)
		.innerJoin(
			auth_organizations,
			eq(auth_organizations.id, verification_sessions.organizationId),
		)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!row || row.pendingDeletionAt) {
		return {
			ok: false,
			error: {
				code: "SESSION_NOT_FOUND",
				status: 404,
			},
		};
	}

	if (await isPublicVerifySessionHidden(row.session.organizationId)) {
		return {
			ok: false,
			error: {
				code: "SESSION_NOT_FOUND",
				status: 404,
			},
		};
	}

	const session = await expireVerificationSessionIfNeeded({
		env,
		now,
		row: row.session,
	});

	if (
		isTerminalSessionStatus(session.status) ||
		session.expiresAt.getTime() < now.getTime()
	) {
		return {
			ok: false,
			error: {
				code: "SESSION_EXPIRED",
				status: 410,
			},
		};
	}

	if (
		!(
			input.biometricConsent &&
			input.documentProcessingConsent &&
			input.privacyNoticeAcknowledged &&
			input.shareClaimsConsent &&
			input.termsAcknowledged
		)
	) {
		return {
			ok: false,
			error: {
				code: "CONSENT_REQUIRED",
				status: 400,
			},
		};
	}

	const consentId = generateId({ type: "vc" });
	const shareFields = resolvePublicShareFields(session.shareFields);
	const requestedClaimKeys = getShareFieldKeys(shareFields);
	const requiredClaimKeys = getRequiredClaimKeys(shareFields);

	await db.insert(verification_consents).values({
		id: consentId,
		organizationId: session.organizationId,
		verificationSessionId: session.id,
		verificationAttemptId: null,
		consentedAt: now,
		consentUiVersion: CONSENT_UI_VERSION,
		termsVersion: TERMS_VERSION,
		privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
		shareContractHash: await computeShareContractHash(shareFields),
		requestedClaimKeys,
		selectedClaimKeys: requestedClaimKeys,
		requiredClaimKeys,
		documentProcessingConsent: input.documentProcessingConsent,
		biometricConsent: input.biometricConsent,
		shareClaimsConsent: input.shareClaimsConsent,
		termsAcknowledged: input.termsAcknowledged,
		privacyNoticeAcknowledged: input.privacyNoticeAcknowledged,
		rpName: row.organizationName,
		controllerName: row.organizationName,
	});

	return {
		ok: true,
		data: {
			consent_id: consentId,
			consented_at: now.toISOString(),
		},
	};
}
