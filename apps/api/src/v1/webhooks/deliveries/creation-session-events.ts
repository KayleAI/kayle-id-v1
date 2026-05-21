import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import type { VerifyShareManifest } from "@/v1/verify/share-manifest";
import {
	createVerificationSessionWebhookDeliveries,
	createWebhookDeliveriesForEvent,
} from "./creation-core";
import {
	buildVerificationSessionCancelledPayload,
	buildVerificationSessionExpiredPayload,
	buildVerificationSessionFailedPayload,
	buildVerificationSessionSucceededPayload,
} from "./payloads";
import type {
	VerificationSessionCancelledOutcome,
	VerificationSessionCancelledReason,
	VerificationSessionFailedCode,
} from "./types";

export async function createWebhookDeliveriesForVerificationSessionSucceededWithManifest({
	eventId,
	manifest,
	organizationId,
}: {
	eventId: string;
	manifest: VerifyShareManifest;
	organizationId: string;
}): Promise<string[]> {
	const [session] = await db
		.select({
			cancelTokenConsumedAt: verification_sessions.cancelTokenConsumedAt,
			status: verification_sessions.status,
			webhookEndpointIds: verification_sessions.webhookEndpointIds,
		})
		.from(verification_sessions)
		.where(eq(verification_sessions.id, manifest.sessionId))
		.limit(1);

	if (session?.cancelTokenConsumedAt || session?.status === "cancelled") {
		return [];
	}

	return createWebhookDeliveriesForEvent({
		eventId,
		eventType: "verification.session.succeeded",
		organizationId,
		payload: buildVerificationSessionSucceededPayload({
			eventId,
			manifest,
		}),
		webhookEndpointIds: session?.webhookEndpointIds ?? null,
	});
}

export async function createWebhookDeliveriesForVerificationSessionSucceeded(_input: {
	contractVersion: number;
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return [];
}

export async function createWebhookDeliveriesForVerificationSessionFailed({
	contractVersion,
	eventId,
	failureCode,
	nfcTriesUsed,
	livenessTriesUsed,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	failureCode: VerificationSessionFailedCode;
	nfcTriesUsed: number;
	livenessTriesUsed: number;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createVerificationSessionWebhookDeliveries({
		eventId,
		eventType: "verification.session.failed",
		organizationId,
		payload: buildVerificationSessionFailedPayload({
			contractVersion,
			eventId,
			failureCode,
			nfcTriesUsed,
			livenessTriesUsed,
			sessionId,
		}),
		sessionId,
	});
}

export async function createWebhookDeliveriesForVerificationSessionExpired({
	contractVersion,
	eventId,
	organizationId,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	organizationId: string;
	sessionId: string;
}): Promise<string[]> {
	return createVerificationSessionWebhookDeliveries({
		eventId,
		eventType: "verification.session.expired",
		organizationId,
		payload: buildVerificationSessionExpiredPayload({
			contractVersion,
			eventId,
			sessionId,
		}),
		sessionId,
	});
}

export async function createWebhookDeliveriesForVerificationSessionCancelled({
	contractVersion,
	eventId,
	livenessTriesUsed,
	nfcTriesUsed,
	organizationId,
	outcome,
	reason,
	sessionId,
}: {
	contractVersion: number;
	eventId: string;
	livenessTriesUsed: number;
	nfcTriesUsed: number;
	organizationId: string;
	outcome: VerificationSessionCancelledOutcome;
	reason: VerificationSessionCancelledReason;
	sessionId: string;
}): Promise<string[]> {
	return createVerificationSessionWebhookDeliveries({
		eventId,
		eventType: "verification.session.cancelled",
		organizationId,
		payload: buildVerificationSessionCancelledPayload({
			contractVersion,
			eventId,
			livenessTriesUsed,
			nfcTriesUsed,
			outcome,
			reason,
			sessionId,
		}),
		sessionId,
	});
}
