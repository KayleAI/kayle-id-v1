import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { webhook_deliveries } from "@kayle-id/database/schema/webhooks";
import { and, desc, eq, inArray } from "drizzle-orm";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import {
	getPublicVerifySessionDetails,
	type PublicVerifySessionDetails,
} from "./session-details";
import { isTerminalSessionStatus } from "./status";

type PublicVerifySessionPrivacyOrganization = Pick<
	PublicVerifySessionDetails,
	| "organization_business_jurisdiction"
	| "organization_business_name"
	| "organization_business_registration_number"
	| "organization_business_type"
	| "organization_description"
	| "organization_id"
	| "organization_logo"
	| "organization_name"
	| "organization_owner_id_check_completed"
	| "organization_privacy_policy_url"
	| "organization_terms_of_service_url"
	| "organization_verified_apex_domains"
	| "organization_website"
	| "rp_fallback"
>;

export type PublicVerifySessionPrivacyContext =
	PublicVerifySessionPrivacyOrganization & {
		session_id: string;
		status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
		is_terminal: boolean;
		has_withdrawn_consent: boolean;
		latest_attempt_id: string | null;
		result_webhook_deliveries: {
			total_count: number;
			succeeded_count: number;
			undelivered_count: number;
		};
	};

async function getResultWebhookDeliverySummary({
	attemptIds,
	organizationId,
}: {
	attemptIds: string[];
	organizationId: string;
}): Promise<PublicVerifySessionPrivacyContext["result_webhook_deliveries"]> {
	if (attemptIds.length === 0) {
		return {
			total_count: 0,
			succeeded_count: 0,
			undelivered_count: 0,
		};
	}

	const deliveryRows = await db
		.select({
			status: webhook_deliveries.status,
		})
		.from(events)
		.innerJoin(webhook_deliveries, eq(webhook_deliveries.eventId, events.id))
		.where(
			and(
				eq(events.organizationId, organizationId),
				eq(events.type, "verification.attempt.succeeded"),
				inArray(events.triggerId, attemptIds),
			),
		);
	const succeededCount = deliveryRows.filter(
		(delivery) => delivery.status === "succeeded",
	).length;

	return {
		total_count: deliveryRows.length,
		succeeded_count: succeededCount,
		undelivered_count: deliveryRows.length - succeededCount,
	};
}

export async function getPublicVerifySessionPrivacyContext({
	env,
	now = new Date(),
	sessionId,
}: {
	env?: CloudflareBindings;
	now?: Date;
	sessionId: string;
}): Promise<PublicVerifySessionPrivacyContext | null> {
	const [rawSession] = await db
		.select({
			session: verification_sessions,
			organizationId: verification_sessions.organizationId,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, sessionId))
		.limit(1);

	if (!rawSession) {
		return null;
	}

	const details = await getPublicVerifySessionDetails({ sessionId });
	if (!details) {
		return null;
	}

	const session = await expireVerificationSessionIfNeeded({
		env,
		now,
		row: rawSession.session,
	});

	const attempts = await db
		.select({
			id: verification_attempts.id,
		})
		.from(verification_attempts)
		.where(eq(verification_attempts.verificationSessionId, session.id))
		.orderBy(desc(verification_attempts.createdAt));
	const latestAttemptId = attempts[0]?.id ?? null;
	const resultWebhookDeliveries = await getResultWebhookDeliverySummary({
		attemptIds: attempts.map((attempt) => attempt.id),
		organizationId: session.organizationId,
	});

	return {
		session_id: session.id,
		status: session.status,
		is_terminal: isTerminalSessionStatus(session.status),
		has_withdrawn_consent: session.cancelTokenConsumedAt !== null,
		organization_id: details.organization_id,
		organization_name: details.organization_name,
		organization_owner_id_check_completed:
			details.organization_owner_id_check_completed,
		organization_verified_apex_domains:
			details.organization_verified_apex_domains,
		organization_logo: details.organization_logo,
		organization_business_type: details.organization_business_type,
		organization_business_name: details.organization_business_name,
		organization_business_jurisdiction:
			details.organization_business_jurisdiction,
		organization_business_registration_number:
			details.organization_business_registration_number,
		organization_privacy_policy_url: details.organization_privacy_policy_url,
		organization_terms_of_service_url:
			details.organization_terms_of_service_url,
		organization_website: details.organization_website,
		organization_description: details.organization_description,
		rp_fallback: details.rp_fallback,
		latest_attempt_id: latestAttemptId,
		result_webhook_deliveries: resultWebhookDeliveries,
	};
}
