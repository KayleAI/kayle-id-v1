import { describe, expect, test } from "bun:test";
import {
	createZeroFilledSessionAnalyticsTimeline,
	createZeroFilledSessionAnalyticsTrend,
	formatUtcDateKey,
	shouldRunExpiredSessionNormalization,
} from "@/v1/analytics/session-analytics";

describe("session analytics helpers", () => {
	test("creates a zero-filled 14 day trend ending on the provided day", () => {
		const trend = createZeroFilledSessionAnalyticsTrend({
			now: new Date("2026-03-21T16:45:00.000Z"),
		});

		expect(trend).toHaveLength(14);
		expect(trend[0]).toEqual({
			date: "2026-03-08",
			success: 0,
			failure: 0,
			expired: 0,
			cancelled: 0,
		});
		expect(trend.at(-1)).toEqual({
			date: "2026-03-21",
			success: 0,
			failure: 0,
			expired: 0,
			cancelled: 0,
		});
	});

	test("creates a zero-filled 14 day cumulative timeline ending on the provided day", () => {
		const timeline = createZeroFilledSessionAnalyticsTimeline({
			now: new Date("2026-03-21T16:45:00.000Z"),
		});

		expect(timeline).toHaveLength(14);
		expect(timeline[0]).toEqual({
			date: "2026-03-08",
			total: 0,
			active: 0,
			success: 0,
			failure: 0,
			expired: 0,
			cancelled: 0,
		});
		expect(timeline.at(-1)).toEqual({
			date: "2026-03-21",
			total: 0,
			active: 0,
			success: 0,
			failure: 0,
			expired: 0,
			cancelled: 0,
		});
	});

	test("runs expired-session normalization on 5-minute boundaries", () => {
		expect(
			shouldRunExpiredSessionNormalization(
				new Date("2026-03-21T12:00:00.000Z"),
			),
		).toBeTrue();
		expect(
			shouldRunExpiredSessionNormalization(
				new Date("2026-03-21T12:05:00.000Z"),
			),
		).toBeTrue();
		expect(
			shouldRunExpiredSessionNormalization(
				new Date("2026-03-21T12:06:00.000Z"),
			),
		).toBeFalse();
	});

	test("formats string timestamps from raw analytics queries", () => {
		expect(formatUtcDateKey("2026-03-21T23:04:29.727Z")).toBe("2026-03-21");
		expect(formatUtcDateKey("2026-03-21")).toBe("2026-03-21");
	});
});
