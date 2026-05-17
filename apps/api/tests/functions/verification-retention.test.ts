import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import {
	events,
	mobile_attest_keys,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { eq, like } from "drizzle-orm";
import {
	runVerificationRetentionSweep,
	shouldRunVerificationRetentionSweep,
} from "@/scheduled/verification-retention";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

const NOW = new Date("2000-02-01T02:23:00.000Z");

function daysAgo(days: number): Date {
	return new Date(NOW.getTime() - days * 24 * 60 * 60_000);
}

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
	await db
		.delete(audit_logs)
		.where(eq(audit_logs.organizationId, TEST_DATA.organizationId));
	await db
		.delete(mobile_attest_keys)
		.where(like(mobile_attest_keys.keyId, "test_retention_%"));
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("shouldRunVerificationRetentionSweep", () => {
	test("runs once per day on the configured UTC minute", () => {
		expect(
			shouldRunVerificationRetentionSweep(new Date("2026-05-17T02:23:00.000Z")),
		).toBeTrue();
		expect(
			shouldRunVerificationRetentionSweep(new Date("2026-05-17T02:22:00.000Z")),
		).toBeFalse();
		expect(
			shouldRunVerificationRetentionSweep(new Date("2026-05-17T03:23:00.000Z")),
		).toBeFalse();
	});
});

describe("runVerificationRetentionSweep", () => {
	test("purges terminal rows, minimizes attempts, and deletes stale attestation keys", async () => {
		const organizationId = TEST_DATA?.organizationId ?? "";
		const staleKeyId = `test_retention_stale_${crypto.randomUUID()}`;
		const retainedKeyId = `test_retention_retained_${crypto.randomUUID()}`;

		await db.insert(mobile_attest_keys).values([
			{
				keyId: staleKeyId,
				provider: "ios_app_attest",
				publicKeyCose: "AA",
				counter: 1,
				lastUsedAt: daysAgo(91),
			},
			{
				keyId: retainedKeyId,
				provider: "ios_app_attest",
				publicKeyCose: "AA",
				counter: 1,
				lastUsedAt: daysAgo(91),
			},
		]);

		await db.insert(verification_sessions).values([
			{
				id: "vs_retention_delete",
				organizationId,
				status: "completed",
				contractVersion: 1,
				shareFields: {},
				completedAt: daysAgo(31),
				createdAt: daysAgo(32),
				expiresAt: daysAgo(31),
			},
			{
				id: "vs_retention_minimize",
				organizationId,
				status: "completed",
				contractVersion: 1,
				shareFields: {},
				completedAt: daysAgo(10),
				createdAt: daysAgo(11),
				expiresAt: daysAgo(10),
			},
			{
				id: "vs_retention_recent",
				organizationId,
				status: "completed",
				contractVersion: 1,
				shareFields: {},
				completedAt: daysAgo(2),
				createdAt: daysAgo(3),
				expiresAt: daysAgo(2),
			},
		]);

		await db.insert(verification_attempts).values([
			{
				id: "va_retention_minimize",
				verificationSessionId: "vs_retention_minimize",
				status: "failed",
				failureCode: "selfie_face_mismatch",
				mobileWriteTokenSeed: "seed",
				mobileWriteTokenHash: "hash",
				mobileWriteTokenIssuedAt: daysAgo(10),
				mobileWriteTokenExpiresAt: daysAgo(9),
				mobileWriteTokenConsumedAt: daysAgo(9),
				mobileHelloDeviceIdHash: "device-hash",
				mobileHelloAppVersion: "1.0.0",
				currentPhase: "liveness_complete",
				phaseUpdatedAt: daysAgo(9),
				riskScore: 0.7,
				completedAt: daysAgo(8),
				claimedByConnectionId: "conn_old",
				claimedAt: daysAgo(8),
				mobileAttestKeyId: staleKeyId,
			},
			{
				id: "va_retention_recent",
				verificationSessionId: "vs_retention_recent",
				status: "failed",
				failureCode: "selfie_face_mismatch",
				mobileWriteTokenSeed: "recent-seed",
				riskScore: 0.4,
				completedAt: daysAgo(2),
				mobileAttestKeyId: retainedKeyId,
			},
		]);

		await db.insert(events).values([
			{
				id: "evt_retention_delete",
				organizationId,
				type: "verification.attempt.failed",
				triggerId: "va_retention_minimize",
				triggerType: "verification_attempt",
				createdAt: daysAgo(31),
			},
			{
				id: "evt_retention_recent",
				organizationId,
				type: "verification.attempt.failed",
				triggerId: "va_retention_recent",
				triggerType: "verification_attempt",
				createdAt: daysAgo(2),
			},
			{
				id: "evt_retention_payload",
				organizationId,
				type: "verification.attempt.failed",
				triggerId: "va_retention_recent",
				triggerType: "verification_attempt",
				createdAt: daysAgo(31),
			},
		]);

		await db.insert(webhook_endpoints).values({
			id: "whe_retention_payload",
			organizationId,
			signingSecretCiphertext: "ciphertext",
			subscribedEventTypes: ["verification.attempt.failed"],
			url: "https://example.com/webhook",
		});
		await db.insert(webhook_deliveries).values({
			id: "whd_retention_payload",
			eventId: "evt_retention_payload",
			webhookEndpointId: "whe_retention_payload",
			status: "failed",
			payload: "retained-encrypted-payload",
			payloadExpiresAt: daysAgo(-1),
			payloadRetentionReason: "terminal_failure_retention",
		});

		await db.insert(audit_logs).values([
			{
				id: "aud_retention_delete",
				organizationId,
				actorType: "system",
				event: "session.failed",
				targetId: "vs_retention_minimize",
				targetType: "verification_session",
				createdAt: daysAgo(366),
			},
			{
				id: "aud_retention_recent",
				organizationId,
				actorType: "system",
				event: "session.failed",
				targetId: "vs_retention_recent",
				targetType: "verification_session",
				createdAt: daysAgo(100),
			},
		]);

		const result = await runVerificationRetentionSweep({ now: NOW });

		expect(result).toEqual({
			deletedAuditLogCount: 1,
			deletedEventCount: 1,
			deletedMobileAttestKeyCount: 1,
			deletedSessionCount: 1,
			failed: false,
			minimizedAttemptCount: 1,
		});

		const [deletedSession] = await db
			.select({ id: verification_sessions.id })
			.from(verification_sessions)
			.where(eq(verification_sessions.id, "vs_retention_delete"))
			.limit(1);
		expect(deletedSession).toBeUndefined();

		const [minimizedAttempt] = await db
			.select()
			.from(verification_attempts)
			.where(eq(verification_attempts.id, "va_retention_minimize"))
			.limit(1);
		expect(minimizedAttempt?.failureCode).toBeNull();
		expect(minimizedAttempt?.mobileWriteTokenSeed).toBeNull();
		expect(minimizedAttempt?.mobileHelloDeviceIdHash).toBeNull();
		expect(minimizedAttempt?.mobileHelloAppVersion).toBeNull();
		expect(minimizedAttempt?.currentPhase).toBeNull();
		expect(minimizedAttempt?.riskScore).toBe(0);
		expect(minimizedAttempt?.claimedByConnectionId).toBeNull();
		expect(minimizedAttempt?.mobileAttestKeyId).toBeNull();

		const [recentAttempt] = await db
			.select()
			.from(verification_attempts)
			.where(eq(verification_attempts.id, "va_retention_recent"))
			.limit(1);
		expect(recentAttempt?.failureCode).toBe("selfie_face_mismatch");
		expect(recentAttempt?.mobileAttestKeyId).toBe(retainedKeyId);

		const [deletedEvent] = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.id, "evt_retention_delete"))
			.limit(1);
		const [retainedPayloadEvent] = await db
			.select({ id: events.id })
			.from(events)
			.where(eq(events.id, "evt_retention_payload"))
			.limit(1);
		expect(deletedEvent).toBeUndefined();
		expect(retainedPayloadEvent?.id).toBe("evt_retention_payload");

		const [deletedAuditLog] = await db
			.select({ id: audit_logs.id })
			.from(audit_logs)
			.where(eq(audit_logs.id, "aud_retention_delete"))
			.limit(1);
		const [recentAuditLog] = await db
			.select({ id: audit_logs.id })
			.from(audit_logs)
			.where(eq(audit_logs.id, "aud_retention_recent"))
			.limit(1);
		expect(deletedAuditLog).toBeUndefined();
		expect(recentAuditLog?.id).toBe("aud_retention_recent");

		const [deletedStaleKey] = await db
			.select({ keyId: mobile_attest_keys.keyId })
			.from(mobile_attest_keys)
			.where(eq(mobile_attest_keys.keyId, staleKeyId))
			.limit(1);
		const [retainedReferencedKey] = await db
			.select({ keyId: mobile_attest_keys.keyId })
			.from(mobile_attest_keys)
			.where(eq(mobile_attest_keys.keyId, retainedKeyId))
			.limit(1);
		expect(deletedStaleKey).toBeUndefined();
		expect(retainedReferencedKey?.keyId).toBe(retainedKeyId);
	});

	test("returns failure stats instead of throwing", async () => {
		const result = await runVerificationRetentionSweep({
			now: new Date(Number.NaN),
		});

		expect(result).toEqual({
			deletedAuditLogCount: 0,
			deletedEventCount: 0,
			deletedMobileAttestKeyCount: 0,
			deletedSessionCount: 0,
			failed: true,
			minimizedAttemptCount: 0,
		});
	});
});
