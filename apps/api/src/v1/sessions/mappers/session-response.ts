import type {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";

function buildVerificationUrl(id: string, cancelToken?: string) {
	const base =
		process.env.NODE_ENV === "production"
			? "https://verify.kayle.id"
			: "http://localhost:2999";
	const url = new URL(`/${id}`, base);
	if (cancelToken) {
		url.searchParams.set("cancel_token", cancelToken);
	}
	return url.toString();
}

export function mapAttemptRowToResponse(
	attempt: typeof verification_attempts.$inferSelect,
) {
	return {
		id: attempt.id,
		session_id: attempt.verificationSessionId,
		status: attempt.status,
		failure_code: attempt.failureCode ?? null,
		risk_score: attempt.riskScore,
		completed_at: attempt.completedAt
			? attempt.completedAt.toISOString()
			: null,
		created_at: attempt.createdAt.toISOString(),
		updated_at: attempt.updatedAt.toISOString(),
	};
}

export function mapSessionRowToResponse({
	row,
	attempts,
	cancelToken,
}: {
	row: typeof verification_sessions.$inferSelect;
	attempts?: (typeof verification_attempts.$inferSelect)[];
	/**
	 * Plaintext cancel token for the verify browser / native app. Only set on
	 * the create-session response — never re-derivable from a stored row, since
	 * we only persist the HMAC.
	 */
	cancelToken?: string;
}) {
	return {
		id: row.id,
		status: row.status,
		contract_version: row.contractVersion,
		share_fields: row.shareFields as ShareFields,
		redirect_url: row.redirectUrl ?? null,
		verification_url: buildVerificationUrl(row.id, cancelToken),
		expires_at: row.expiresAt.toISOString(),
		completed_at: row.completedAt ? row.completedAt.toISOString() : null,
		created_at: row.createdAt.toISOString(),
		updated_at: row.updatedAt.toISOString(),
		...(cancelToken ? { cancel_token: cancelToken } : {}),
		...(attempts
			? {
					attempts: attempts.map(mapAttemptRowToResponse),
				}
			: {}),
	};
}
