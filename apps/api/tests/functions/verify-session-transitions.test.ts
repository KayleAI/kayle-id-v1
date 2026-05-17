import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	mobile_attest_keys,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import {
	markSessionInProgress,
	persistFirstHelloState,
} from "@/v1/verify/hello-auth";
import {
	MAX_FAILED_ATTEMPTS,
	markAttemptFailed,
	markAttemptSucceeded,
} from "@/v1/verify/outcome";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function seedActiveSessionWithAttempt(): Promise<{
	attemptId: string;
	session: typeof verification_sessions.$inferSelect;
}> {
	if (!TEST_DATA) {
		throw new Error("Test data not initialized");
	}

	const sessionId = generateId({ type: "vs" });
	const attemptId = generateId({ type: "va" });
	const [session] = await db
		.insert(verification_sessions)
		.values({
			id: sessionId,
			organizationId: TEST_DATA.organizationId,
			status: "in_progress",
			contractVersion: 1,
			shareFields: {},
			expiresAt: new Date("2026-12-31T00:00:00.000Z"),
		})
		.returning();

	if (!session) {
		throw new Error("Failed to seed active verification session");
	}

	await db.insert(verification_attempts).values({
		id: attemptId,
		verificationSessionId: sessionId,
		status: "in_progress",
	});

	return { attemptId, session };
}

describe("verify session state transitions", () => {
	test("persistFirstHelloState marks the session in progress and consumes the hello attempt", async () => {
		if (!TEST_DATA) {
			throw new Error("Test data not initialized");
		}

		const sessionId = generateId({ type: "vs" });
		const attemptId = generateId({ type: "va" });
		const attestKeyId = `test-${crypto.randomUUID()}`;
		const [session] = await db
			.insert(verification_sessions)
			.values({
				id: sessionId,
				organizationId: TEST_DATA.organizationId,
				status: "created",
				contractVersion: 1,
				shareFields: {},
				expiresAt: new Date("2026-12-31T00:00:00.000Z"),
			})
			.returning({
				id: verification_sessions.id,
				status: verification_sessions.status,
			});

		if (!session) {
			throw new Error("Failed to seed verification session");
		}

		await db.insert(mobile_attest_keys).values({
			keyId: attestKeyId,
			provider: "ios_app_attest",
		});

		await db.insert(verification_attempts).values({
			id: attemptId,
			verificationSessionId: sessionId,
			status: "in_progress",
		});

		const changed = await persistFirstHelloState({
			appVersion: "1.2.3",
			attemptId,
			deviceIdHash: "device-hash",
			mobileAttestKeyId: attestKeyId,
			session,
		});

		expect(changed).toBe(true);
		expect(session.status).toBe("in_progress");

		const [sessionAfter] = await db
			.select({
				status: verification_sessions.status,
			})
			.from(verification_sessions)
			.where(eq(verification_sessions.id, sessionId))
			.limit(1);
		expect(sessionAfter?.status).toBe("in_progress");

		const [attemptAfter] = await db
			.select({
				currentPhase: verification_attempts.currentPhase,
				mobileAttestKeyId: verification_attempts.mobileAttestKeyId,
				mobileHelloAppVersion: verification_attempts.mobileHelloAppVersion,
				mobileHelloDeviceIdHash: verification_attempts.mobileHelloDeviceIdHash,
				mobileWriteTokenConsumedAt:
					verification_attempts.mobileWriteTokenConsumedAt,
				phaseUpdatedAt: verification_attempts.phaseUpdatedAt,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);

		expect(attemptAfter?.currentPhase).toBe("mobile_connected");
		expect(attemptAfter?.mobileAttestKeyId).toBe(attestKeyId);
		expect(attemptAfter?.mobileHelloAppVersion).toBe("1.2.3");
		expect(attemptAfter?.mobileHelloDeviceIdHash).toBe("device-hash");
		expect(attemptAfter?.mobileWriteTokenConsumedAt).toBeInstanceOf(Date);
		expect(attemptAfter?.phaseUpdatedAt).toBeInstanceOf(Date);

		await db
			.update(verification_attempts)
			.set({
				mobileAttestKeyId: null,
			})
			.where(eq(verification_attempts.id, attemptId));
		await db
			.delete(mobile_attest_keys)
			.where(eq(mobile_attest_keys.keyId, attestKeyId));
	});

	test("markSessionInProgress does not resurrect a terminal session", async () => {
		if (!TEST_DATA) {
			throw new Error("Test data not initialized");
		}

		const sessionId = generateId({ type: "vs" });
		await db.insert(verification_sessions).values({
			id: sessionId,
			organizationId: TEST_DATA.organizationId,
			status: "completed",
			contractVersion: 1,
			shareFields: {},
			completedAt: new Date("2026-01-01T00:00:00.000Z"),
			expiresAt: new Date("2026-12-31T00:00:00.000Z"),
		});

		const changed = await markSessionInProgress({
			id: sessionId,
			status: "created",
		});

		expect(changed).toBe(false);

		const [sessionAfter] = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.id, sessionId))
			.limit(1);
		expect(sessionAfter?.status).toBe("completed");
	});

	test("markAttemptSucceeded does not overwrite a concurrently completed session", async () => {
		const { attemptId, session } = await seedActiveSessionWithAttempt();
		const completedAt = new Date("2026-01-02T00:00:00.000Z");

		await db
			.update(verification_sessions)
			.set({
				status: "completed",
				completedAt,
			})
			.where(eq(verification_sessions.id, session.id));

		const result = await markAttemptSucceeded({
			session,
			attemptId,
			riskScore: 0.1,
		});

		expect(result).toEqual({
			attemptSucceededEventId: null,
		});

		const [sessionAfter] = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id))
			.limit(1);
		expect(sessionAfter?.status).toBe("completed");
		expect(sessionAfter?.completedAt?.toISOString()).toBe(
			completedAt.toISOString(),
		);

		const [attemptAfter] = await db
			.select()
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);
		expect(attemptAfter?.status).toBe("in_progress");

		const successEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, session.id),
					eq(events.type, "verification.session.completed"),
				),
			);
		expect(successEvents.length).toBe(0);
	});

	test("markAttemptSucceeded emits only the attempt success event", async () => {
		const { attemptId, session } = await seedActiveSessionWithAttempt();

		const result = await markAttemptSucceeded({
			session,
			attemptId,
			riskScore: 0.1,
		});

		expect(result.attemptSucceededEventId).toBeString();

		const [sessionAfter] = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id))
			.limit(1);
		expect(sessionAfter?.status).toBe("completed");
		expect(sessionAfter?.completedAt).toBeInstanceOf(Date);

		const attemptEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, attemptId),
					eq(events.type, "verification.attempt.succeeded"),
				),
			);
		expect(attemptEvents).toHaveLength(1);

		const sessionEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, session.id),
					eq(events.type, "verification.session.completed"),
				),
			);
		expect(sessionEvents).toHaveLength(0);
	});

	test("markAttemptFailed rolls back when the session is no longer active", async () => {
		const { attemptId, session } = await seedActiveSessionWithAttempt();

		await db
			.update(verification_sessions)
			.set({
				status: "cancelled",
				completedAt: new Date("2026-01-03T00:00:00.000Z"),
			})
			.where(eq(verification_sessions.id, session.id));

		const result = await markAttemptFailed({
			session,
			attemptId,
			failureCode: "selfie_face_mismatch",
			riskScore: 0.2,
		});

		expect(result).toEqual({
			deliveryIds: [],
			failedAttempts: MAX_FAILED_ATTEMPTS,
			terminalized: true,
		});

		const [attemptAfter] = await db
			.select()
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);
		expect(attemptAfter?.status).toBe("in_progress");
		expect(attemptAfter?.failureCode).toBeNull();

		const failureEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, attemptId),
					eq(events.type, "verification.attempt.failed"),
				),
			);
		expect(failureEvents.length).toBe(0);
	});

	test("markAttemptFailed terminalizes without session completed events", async () => {
		const { attemptId, session } = await seedActiveSessionWithAttempt();

		await db.insert(verification_attempts).values([
			{
				id: generateId({ type: "va" }),
				verificationSessionId: session.id,
				status: "failed",
				failureCode: "selfie_face_mismatch",
				riskScore: 0.4,
				completedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
			{
				id: generateId({ type: "va" }),
				verificationSessionId: session.id,
				status: "failed",
				failureCode: "selfie_face_mismatch",
				riskScore: 0.5,
				completedAt: new Date("2026-01-02T00:00:00.000Z"),
			},
		]);

		const result = await markAttemptFailed({
			session,
			attemptId,
			failureCode: "selfie_face_mismatch",
			riskScore: 0.6,
		});

		expect(result.failedAttempts).toBe(MAX_FAILED_ATTEMPTS);
		expect(result.terminalized).toBe(true);

		const [sessionAfter] = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.id, session.id))
			.limit(1);
		expect(sessionAfter?.status).toBe("completed");
		expect(sessionAfter?.completedAt).toBeInstanceOf(Date);

		const failureEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, attemptId),
					eq(events.type, "verification.attempt.failed"),
				),
			);
		expect(failureEvents).toHaveLength(1);

		const sessionEvents = await db
			.select({ id: events.id })
			.from(events)
			.where(
				and(
					eq(events.triggerId, session.id),
					eq(events.type, "verification.session.completed"),
				),
			);
		expect(sessionEvents).toHaveLength(0);
	});
});
