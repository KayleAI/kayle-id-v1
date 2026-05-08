import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import app from "@/index";
import { formatUtcDateKey } from "@/v1/analytics/session-analytics";
import { normalizeExpiredVerificationSessions } from "@/v1/sessions/repo/session-repo";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

type SessionAnalyticsOverviewResponse = {
	data: {
		summary: {
			total: number;
			active: number;
			success: number;
			failure: number;
			expired: number;
			cancelled: number;
		};
		trend: Array<{
			date: string;
			success: number;
			failure: number;
			expired: number;
			cancelled: number;
		}>;
		timeline: Array<{
			date: string;
			total: number;
			active: number;
			success: number;
			failure: number;
			expired: number;
			cancelled: number;
		}>;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

function getUtcDateOffset(days: number, hour = 12): Date {
	const date = new Date();
	date.setUTCHours(hour, 0, 0, 0);
	date.setUTCDate(date.getUTCDate() + days);
	return date;
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	if (!TEST_DATA?.organizationId) {
		return;
	}

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

describe("/v1/analytics/sessions/overview", () => {
	test.serial(
		"GET / returns derived session summary, trend, and timeline",
		async () => {
			const organizationId = TEST_DATA?.organizationId ?? "";
			const successCompletedAt = getUtcDateOffset(-1, 9);
			const failureCompletedAt = getUtcDateOffset(-2, 10);
			const expiredCompletedAt = getUtcDateOffset(-3, 11);
			const cancelledCompletedAt = getUtcDateOffset(-4, 8);
			const derivedExpiredAt = getUtcDateOffset(-5, 7);
			const activeCreatedAt = getUtcDateOffset(-6, 12);
			const earlierSuccessCompletedAt = getUtcDateOffset(-19, 9);
			const successCreatedAt = getUtcDateOffset(-4, 12);
			const earlierSuccessCreatedAt = getUtcDateOffset(-20, 12);
			const failureCreatedAt = getUtcDateOffset(-5, 12);
			const expiredCreatedAt = getUtcDateOffset(-6, 10);
			const cancelledCreatedAt = getUtcDateOffset(-6, 9);
			const derivedExpiredCreatedAt = getUtcDateOffset(-7, 9);

			await db.insert(verification_sessions).values([
				{
					id: "vs_analytics_active",
					organizationId,
					status: "created",
					contractVersion: 1,
					shareFields: {},
					createdAt: activeCreatedAt,
					expiresAt: getUtcDateOffset(2, 12),
				},
				{
					id: "vs_analytics_success",
					organizationId,
					status: "completed",
					contractVersion: 1,
					shareFields: {},
					completedAt: successCompletedAt,
					createdAt: successCreatedAt,
					expiresAt: getUtcDateOffset(3, 12),
				},
				{
					id: "vs_analytics_success_before_window",
					organizationId,
					status: "completed",
					contractVersion: 1,
					shareFields: {},
					completedAt: earlierSuccessCompletedAt,
					createdAt: earlierSuccessCreatedAt,
					expiresAt: getUtcDateOffset(-18, 12),
				},
				{
					id: "vs_analytics_failure",
					organizationId,
					status: "completed",
					contractVersion: 1,
					shareFields: {},
					completedAt: failureCompletedAt,
					createdAt: failureCreatedAt,
					expiresAt: getUtcDateOffset(3, 12),
				},
				{
					id: "vs_analytics_expired",
					organizationId,
					status: "expired",
					contractVersion: 1,
					shareFields: {},
					completedAt: expiredCompletedAt,
					createdAt: expiredCreatedAt,
					expiresAt: expiredCompletedAt,
				},
				{
					id: "vs_analytics_cancelled",
					organizationId,
					status: "cancelled",
					contractVersion: 1,
					shareFields: {},
					completedAt: cancelledCompletedAt,
					createdAt: cancelledCreatedAt,
					expiresAt: getUtcDateOffset(2, 12),
				},
				{
					id: "vs_analytics_derived_expired",
					organizationId,
					status: "created",
					contractVersion: 1,
					shareFields: {},
					createdAt: derivedExpiredCreatedAt,
					expiresAt: derivedExpiredAt,
				},
			]);

			await db.insert(verification_attempts).values([
				{
					id: "va_analytics_success_failed",
					verificationSessionId: "vs_analytics_success",
					status: "failed",
					failureCode: "selfie_face_mismatch",
					completedAt: getUtcDateOffset(-1, 8),
				},
				{
					id: "va_analytics_success_succeeded",
					verificationSessionId: "vs_analytics_success",
					status: "succeeded",
					completedAt: successCompletedAt,
				},
				{
					id: "va_analytics_success_before_window_succeeded",
					verificationSessionId: "vs_analytics_success_before_window",
					status: "succeeded",
					completedAt: earlierSuccessCompletedAt,
				},
				{
					id: "va_analytics_failure_failed",
					verificationSessionId: "vs_analytics_failure",
					status: "failed",
					failureCode: "document_authenticity_failed",
					completedAt: failureCompletedAt,
				},
			]);

			const response = await app.request("/v1/analytics/sessions/overview", {
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "GET",
			});

			expect(response.status).toBe(200);

			const payload =
				(await response.json()) as SessionAnalyticsOverviewResponse;
			const successCreatedDate = formatUtcDateKey(successCreatedAt);
			const successCompletedDate = formatUtcDateKey(successCompletedAt);
			const failureCreatedDate = formatUtcDateKey(failureCreatedAt);
			const failureCompletedDate = formatUtcDateKey(failureCompletedAt);
			const expiredCreatedDate = formatUtcDateKey(expiredCreatedAt);
			const expiredCompletedDate = formatUtcDateKey(expiredCompletedAt);
			const cancelledCreatedDate = formatUtcDateKey(cancelledCreatedAt);
			const cancelledCompletedDate = formatUtcDateKey(cancelledCompletedAt);
			const derivedExpiredCreatedDate = formatUtcDateKey(
				derivedExpiredCreatedAt,
			);
			const derivedExpiredDate = formatUtcDateKey(derivedExpiredAt);
			const earlierSuccessCreatedDate = formatUtcDateKey(
				earlierSuccessCreatedAt,
			);

			expect(payload.error).toBeNull();
			expect(payload.data?.summary).toEqual({
				total: 7,
				active: 1,
				success: 2,
				failure: 1,
				expired: 2,
				cancelled: 1,
			});
			expect(payload.data?.trend).toHaveLength(14);
			expect(payload.data?.timeline).toHaveLength(14);

			const trendByDate = new Map(
				(payload.data?.trend ?? []).map((point) => [point.date, point]),
			);
			const timelineByDate = new Map(
				(payload.data?.timeline ?? []).map((point) => [point.date, point]),
			);

			expect(trendByDate.get(successCreatedDate)).toEqual(
				expect.objectContaining({
					success: 1,
				}),
			);
			expect(trendByDate.get(successCompletedDate)).toEqual(
				expect.objectContaining({
					success: 0,
				}),
			);
			expect(trendByDate.get(failureCreatedDate)).toEqual(
				expect.objectContaining({
					failure: 1,
				}),
			);
			expect(trendByDate.get(failureCompletedDate)).toEqual(
				expect.objectContaining({
					failure: 0,
				}),
			);
			expect(trendByDate.get(expiredCreatedDate)).toEqual(
				expect.objectContaining({
					expired: 1,
				}),
			);
			expect(trendByDate.get(expiredCompletedDate)).toEqual(
				expect.objectContaining({
					expired: 0,
				}),
			);
			expect(trendByDate.get(cancelledCreatedDate)).toEqual(
				expect.objectContaining({
					cancelled: 1,
					expired: 1,
				}),
			);
			expect(trendByDate.get(cancelledCompletedDate)).toEqual(
				expect.objectContaining({
					cancelled: 0,
				}),
			);
			expect(trendByDate.get(derivedExpiredCreatedDate)).toEqual(
				expect.objectContaining({
					expired: 1,
				}),
			);
			expect(trendByDate.get(derivedExpiredDate)).toEqual(
				expect.objectContaining({
					expired: 0,
				}),
			);
			expect(trendByDate.get(earlierSuccessCreatedDate)).toBeUndefined();
			expect(timelineByDate.get(derivedExpiredCreatedDate)).toEqual(
				expect.objectContaining({
					total: 1,
					active: 0,
					success: 0,
					failure: 0,
					expired: 1,
					cancelled: 0,
				}),
			);
			expect(timelineByDate.get(successCreatedDate)).toEqual(
				expect.objectContaining({
					total: 6,
					active: 1,
					success: 1,
					failure: 1,
					expired: 2,
					cancelled: 1,
				}),
			);
		},
	);
});

describe("normalizeExpiredVerificationSessions", () => {
	test.serial("expires only due non-terminal sessions", async () => {
		const organizationId = TEST_DATA?.organizationId ?? "";
		const now = getUtcDateOffset(0, 12);

		await db.insert(verification_sessions).values([
			{
				id: "vs_normalize_due_one",
				organizationId,
				status: "created",
				contractVersion: 1,
				shareFields: {},
				expiresAt: getUtcDateOffset(-1, 12),
			},
			{
				id: "vs_normalize_due_two",
				organizationId,
				status: "in_progress",
				contractVersion: 1,
				shareFields: {},
				expiresAt: getUtcDateOffset(-2, 12),
			},
			{
				id: "vs_normalize_future",
				organizationId,
				status: "created",
				contractVersion: 1,
				shareFields: {},
				expiresAt: getUtcDateOffset(1, 12),
			},
			{
				id: "vs_normalize_done",
				organizationId,
				status: "completed",
				contractVersion: 1,
				shareFields: {},
				completedAt: getUtcDateOffset(-1, 10),
				expiresAt: getUtcDateOffset(-1, 12),
			},
		]);

		const processed = await normalizeExpiredVerificationSessions({ now });

		const sessions = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.organizationId, organizationId));
		const sessionsById = new Map(
			sessions.map((session) => [session.id, session]),
		);

		expect(processed).toBe(2);
		expect(sessionsById.get("vs_normalize_due_one")?.status).toBe("expired");
		expect(
			sessionsById.get("vs_normalize_due_one")?.completedAt,
		).not.toBeNull();
		expect(sessionsById.get("vs_normalize_due_two")?.status).toBe("expired");
		expect(sessionsById.get("vs_normalize_future")?.status).toBe("created");
		expect(sessionsById.get("vs_normalize_done")?.status).toBe("completed");
	});
});
