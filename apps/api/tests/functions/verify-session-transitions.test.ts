import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, eq } from "drizzle-orm";
import { generateId } from "@/utils/generate-id";
import { markSessionInProgress } from "@/v1/verify/hello-auth";
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
			sessionCompletedEventId: null,
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
});
