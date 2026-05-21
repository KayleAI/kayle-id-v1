import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { events, verification_sessions } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { file } from "bun";
import { and, eq } from "drizzle-orm";
import { compactDecrypt, importPKCS8 } from "jose";
import {
	cancelVerificationSession,
	recordVerificationSessionPrivacyRequest,
} from "@/v1/sessions/repo/session-repo";
import {
	loadTestPublicJwk,
	seedWebhookEncryptionKey,
	seedWebhookEndpoint,
} from "./helpers/webhook-fixtures";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	if (!TEST_DATA?.organizationId) {
		return;
	}
	await db
		.delete(webhook_endpoints)
		.where(eq(webhook_endpoints.organizationId, TEST_DATA.organizationId));
	await db
		.delete(events)
		.where(eq(events.organizationId, TEST_DATA.organizationId));
	await db
		.delete(verification_sessions)
		.where(eq(verification_sessions.organizationId, TEST_DATA.organizationId));
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function seedSubscribedEndpoint(eventType: string): Promise<void> {
	const publicJwk = await loadTestPublicJwk();
	const endpoint = await seedWebhookEndpoint({
		context: `cancel-${crypto.randomUUID().slice(0, 8)}`,
		organizationId: TEST_DATA?.organizationId ?? "",
		eventTypes: [eventType],
		signingSecretPlaintext: "whsec_cancel_payload_test",
		url: "https://example.com/webhooks/cancel-payload",
	});
	await seedWebhookEncryptionKey({
		context: endpoint.id,
		endpointId: endpoint.id,
		jwk: publicJwk,
	});
}

async function decryptCancelledDeliveryPayload(sessionId: string): Promise<{
	type: string;
	metadata: { contract_version: number; verification_session_id: string };
	data: {
		outcome: string;
		reason: string;
		nfc_tries_used: number;
		liveness_tries_used: number;
	};
}> {
	const eventRows = await db
		.select({ id: events.id, type: events.type })
		.from(events)
		.where(eq(events.triggerId, sessionId));

	const cancelledEvent = eventRows.find(
		(row) => row.type === "verification.session.cancelled",
	);
	expect(cancelledEvent).toBeDefined();
	if (!cancelledEvent) {
		throw new Error("expected_cancelled_event_to_exist");
	}

	const [delivery] = await db
		.select({ payload: webhook_deliveries.payload })
		.from(webhook_deliveries)
		.where(eq(webhook_deliveries.eventId, cancelledEvent.id));

	if (!delivery?.payload) {
		throw new Error("expected_cancelled_delivery_payload_to_exist");
	}

	const privateKey = await file(
		new URL("../../../tests/secrets/rsa_private.pem", import.meta.url),
	).text();
	const { plaintext } = await compactDecrypt(
		delivery.payload,
		await importPKCS8(privateKey, "RSA-OAEP-256"),
	);

	return JSON.parse(new TextDecoder().decode(plaintext));
}

async function insertSession({
	id,
	livenessTriesUsed = 0,
	nfcTriesUsed = 0,
	status = "in_progress",
	failureCode,
	completedAt,
}: {
	id: string;
	livenessTriesUsed?: number;
	nfcTriesUsed?: number;
	status?: "created" | "in_progress" | "succeeded" | "failed";
	failureCode?:
		| "liveness_failed"
		| "document_data_invalid"
		| "selfie_face_mismatch";
	completedAt?: Date;
}): Promise<typeof verification_sessions.$inferSelect> {
	const [row] = await db
		.insert(verification_sessions)
		.values({
			id,
			organizationId: TEST_DATA?.organizationId ?? "",
			status,
			livenessTriesUsed,
			nfcTriesUsed,
			failureCode: failureCode ?? null,
			completedAt: completedAt ?? null,
		})
		.returning();

	if (!row) {
		throw new Error("expected_session_to_insert");
	}
	return row;
}

describe("cancelVerificationSession webhook payload", () => {
	test("plain cancel emits reason=cancelled with zero counters", async () => {
		await seedSubscribedEndpoint("verification.session.cancelled");
		const session = await insertSession({
			id: `vs_plain_${crypto.randomUUID().slice(0, 8)}`,
		});

		await cancelVerificationSession({
			organizationId: session.organizationId,
			row: session,
		});

		const payload = await decryptCancelledDeliveryPayload(session.id);
		expect(payload.type).toBe("verification.session.cancelled");
		expect(payload.metadata.verification_session_id).toBe(session.id);
		expect(payload.data).toEqual({
			outcome: "not_verified",
			reason: "cancelled",
			nfc_tries_used: 0,
			liveness_tries_used: 0,
		});
	});

	test("cancel after partial liveness budget emits cancelled_after_failed_check", async () => {
		await seedSubscribedEndpoint("verification.session.cancelled");
		const session = await insertSession({
			id: `vs_partial_${crypto.randomUUID().slice(0, 8)}`,
			livenessTriesUsed: 2,
		});

		await cancelVerificationSession({
			organizationId: session.organizationId,
			row: session,
		});

		const payload = await decryptCancelledDeliveryPayload(session.id);
		expect(payload.data).toEqual({
			outcome: "not_verified",
			reason: "cancelled_after_failed_check",
			nfc_tries_used: 0,
			liveness_tries_used: 2,
		});
	});

	test("cancel after partial nfc budget emits cancelled_after_failed_check", async () => {
		await seedSubscribedEndpoint("verification.session.cancelled");
		const session = await insertSession({
			id: `vs_nfc_${crypto.randomUUID().slice(0, 8)}`,
			nfcTriesUsed: 1,
		});

		await cancelVerificationSession({
			organizationId: session.organizationId,
			row: session,
		});

		const payload = await decryptCancelledDeliveryPayload(session.id);
		expect(payload.data).toEqual({
			outcome: "not_verified",
			reason: "cancelled_after_failed_check",
			nfc_tries_used: 1,
			liveness_tries_used: 0,
		});
	});
});

describe("recordVerificationSessionPrivacyRequest replacement webhook", () => {
	test("synthesizes cancelled webhook when failed delivery was not yet delivered", async () => {
		await seedSubscribedEndpoint("verification.session.cancelled");
		const session = await insertSession({
			id: `vs_priv_failed_${crypto.randomUUID().slice(0, 8)}`,
			status: "failed",
			livenessTriesUsed: 3,
			failureCode: "liveness_failed",
			completedAt: new Date(),
		});

		await recordVerificationSessionPrivacyRequest({
			organizationId: session.organizationId,
			row: session,
		});

		const payload = await decryptCancelledDeliveryPayload(session.id);
		expect(payload.data).toEqual({
			outcome: "not_verified",
			reason: "privacy_cancelled_after_terminal_failure",
			nfc_tries_used: 0,
			liveness_tries_used: 3,
		});

		const [updated] = await db
			.select({ status: verification_sessions.status })
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id));
		expect(updated?.status).toBe("cancelled");
	});

	test("synthesizes cancelled webhook when succeeded delivery was not yet delivered", async () => {
		await seedSubscribedEndpoint("verification.session.cancelled");
		const session = await insertSession({
			id: `vs_priv_succ_${crypto.randomUUID().slice(0, 8)}`,
			status: "succeeded",
			completedAt: new Date(),
		});

		await recordVerificationSessionPrivacyRequest({
			organizationId: session.organizationId,
			row: session,
		});

		const payload = await decryptCancelledDeliveryPayload(session.id);
		expect(payload.data).toEqual({
			outcome: "not_verified",
			reason: "privacy_cancelled_after_terminal_success",
			nfc_tries_used: 0,
			liveness_tries_used: 0,
		});
	});

	test("does not emit replacement when a terminal delivery already succeeded", async () => {
		const publicJwk = await loadTestPublicJwk();
		const endpoint = await seedWebhookEndpoint({
			context: `cancel-suppress-${crypto.randomUUID().slice(0, 8)}`,
			organizationId: TEST_DATA?.organizationId ?? "",
			eventTypes: ["verification.session.failed"],
			signingSecretPlaintext: "whsec_cancel_payload_suppress",
			url: "https://example.com/webhooks/cancel-payload-suppress",
		});
		await seedWebhookEncryptionKey({
			context: endpoint.id,
			endpointId: endpoint.id,
			jwk: publicJwk,
		});

		const session = await insertSession({
			id: `vs_priv_delivered_${crypto.randomUUID().slice(0, 8)}`,
			status: "failed",
			livenessTriesUsed: 3,
			failureCode: "liveness_failed",
			completedAt: new Date(),
		});

		// Seed an already-delivered failed event + delivery so the privacy scrub
		// records a delivered count > 0.
		const failedEventId = `evt_failed_${crypto.randomUUID().slice(0, 8)}`;
		await db.insert(events).values({
			id: failedEventId,
			organizationId: session.organizationId,
			type: "verification.session.failed",
			triggerId: session.id,
			triggerType: "verification_session",
		});
		await db.insert(webhook_deliveries).values({
			id: `whd_${crypto.randomUUID().slice(0, 8)}`,
			eventId: failedEventId,
			webhookEndpointId: endpoint.id,
			status: "succeeded",
			payload: null,
			payloadRetentionReason: "delivered",
			payloadScrubbedAt: new Date(),
			attemptCount: 1,
			lastAttemptAt: new Date(),
			lastStatusCode: 200,
		});

		await recordVerificationSessionPrivacyRequest({
			organizationId: session.organizationId,
			row: session,
		});

		const cancelledEventRows = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, session.id),
					eq(events.type, "verification.session.cancelled"),
				),
			);
		expect(cancelledEventRows).toHaveLength(0);

		const [persisted] = await db
			.select({ status: verification_sessions.status })
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id));
		expect(persisted?.status).toBe("failed");
	});
});
