import type { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { and, eq, gte, sql } from "drizzle-orm";
import {
	isAgeOverClaim,
	parseAgeOverThreshold,
} from "@/v1/sessions/domain/share-contract/claim-catalog";
import type { ShareFields } from "@/v1/sessions/domain/share-contract/types";

/**
 * Unverified organizations are limited to this many non-age-only verification
 * sessions in a rolling 24h window. Age-only sessions (a single `age_over_xx`
 * claim) are exempt — those don't reveal identity attributes the way a
 * full-fields session does, so the abuse vector is much smaller.
 */
export const UNVERIFIED_ORG_SESSION_LIMIT = 5;
export const UNVERIFIED_ORG_ROLLING_WINDOW_MS = 24 * 60 * 60 * 1000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A session is "age-only" when its share fields contain exactly one age-gate
 * claim (`age_over_xx`) and `kayle_document_id`. The latter is auto-injected
 * as required by the share contract normalizer, so a caller asking for *only*
 * `age_over_18` ends up with `{ age_over_18, kayle_document_id }` — both of
 * which are non-identifying. Anything else is treated as identity-revealing.
 */
export function isAgeOnlyShareFields(shareFields: ShareFields): boolean {
	const keys = Object.keys(shareFields);
	if (keys.length === 0) {
		return false;
	}

	let ageGateCount = 0;
	for (const key of keys) {
		if (key === "kayle_document_id") {
			continue;
		}
		if (isAgeOverClaim(key) && parseAgeOverThreshold(key) !== null) {
			ageGateCount += 1;
			continue;
		}
		return false;
	}

	return ageGateCount === 1;
}

export type UnverifiedLimitDecision =
	| { kind: "allowed" }
	| { kind: "exempt_age_only" }
	| { kind: "exempt_verified" }
	| { kind: "rejected"; current: number; limit: number; resetAt: Date };

/**
 * Decide whether the given org may create another non-age-only session, using
 * the supplied Drizzle transaction. Callers MUST acquire a per-org advisory
 * lock on the same `tx` before calling this so the count and the subsequent
 * session insert serialize against concurrent identity-session creates.
 *
 * Verified orgs are unconditionally exempt. Age-only sessions are
 * unconditionally exempt. Everything else counts against the rolling 24h
 * window.
 */
export async function applyUnverifiedOrgSessionLimitInTx(
	tx: Tx,
	{
		organizationId,
		isAgeOnly,
		now = new Date(),
	}: {
		organizationId: string;
		isAgeOnly: boolean;
		now?: Date;
	},
): Promise<UnverifiedLimitDecision> {
	if (isAgeOnly) {
		return { kind: "exempt_age_only" };
	}

	const [org] = await tx
		.select({ verifiedAt: auth_organizations.verified_at })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, organizationId))
		.limit(1);

	if (org?.verifiedAt) {
		return { kind: "exempt_verified" };
	}

	const windowStart = new Date(
		now.getTime() - UNVERIFIED_ORG_ROLLING_WINDOW_MS,
	);
	const [row] = await tx
		.select({ count: sql<number>`count(*)::int` })
		.from(verification_sessions)
		.where(
			and(
				eq(verification_sessions.organizationId, organizationId),
				eq(verification_sessions.isAgeOnly, false),
				gte(verification_sessions.createdAt, windowStart),
			),
		);

	const current = row?.count ?? 0;
	if (current >= UNVERIFIED_ORG_SESSION_LIMIT) {
		return {
			kind: "rejected",
			current,
			limit: UNVERIFIED_ORG_SESSION_LIMIT,
			resetAt: new Date(
				windowStart.getTime() + UNVERIFIED_ORG_ROLLING_WINDOW_MS,
			),
		};
	}

	return { kind: "allowed" };
}
