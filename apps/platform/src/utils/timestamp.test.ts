import { describe, expect, test } from "vitest";
import { formatRelative, formatTooltipDuration } from "./timestamp";

const NOW = new Date("2026-05-10T20:00:00.000Z");

function offset(ms: number): string {
	return new Date(NOW.getTime() + ms).toISOString();
}

describe("formatRelative — past", () => {
	test("under a second collapses to 'Just now'", () => {
		expect(formatRelative(offset(-500), NOW)).toBe("Just now");
	});

	test("seconds bucket", () => {
		expect(formatRelative(offset(-5_000), NOW)).toBe("5s ago");
	});

	test("minutes bucket floors", () => {
		expect(formatRelative(offset(-90_000), NOW)).toBe("1m ago");
		expect(formatRelative(offset(-12 * 60_000), NOW)).toBe("12m ago");
	});

	test("hours bucket", () => {
		expect(formatRelative(offset(-3 * 60 * 60_000), NOW)).toBe("3h ago");
	});

	test("≥24h current year renders as short date without year", () => {
		expect(formatRelative("2026-04-30T12:00:00.000Z", NOW)).toBe("Apr 30");
	});

	test("older year renders with year", () => {
		expect(formatRelative("2024-12-12T12:00:00.000Z", NOW)).toBe(
			"Dec 12, 2024",
		);
	});
});

describe("formatRelative — future", () => {
	test("under a second still 'Just now'", () => {
		expect(formatRelative(offset(500), NOW)).toBe("Just now");
	});

	test("seconds bucket gets `in` prefix", () => {
		expect(formatRelative(offset(5_000), NOW)).toBe("in 5s");
	});

	test("minutes bucket", () => {
		expect(formatRelative(offset(7 * 60_000), NOW)).toBe("in 7m");
	});

	test("hours bucket", () => {
		expect(formatRelative(offset(2 * 60 * 60_000), NOW)).toBe("in 2h");
	});

	test("≥24h falls back to absolute date", () => {
		expect(formatRelative("2026-05-30T12:00:00.000Z", NOW)).toBe("May 30");
	});
});

describe("formatTooltipDuration", () => {
	test("collapses very recent to 'Just now'", () => {
		expect(formatTooltipDuration(offset(-2_000), NOW)).toBe("Just now");
	});

	test("seconds-only when under a minute", () => {
		expect(formatTooltipDuration(offset(-30_000), NOW)).toBe("30 seconds ago");
	});

	test("singular vs plural minutes", () => {
		expect(formatTooltipDuration(offset(-60_000), NOW)).toBe("1 minute ago");
		expect(formatTooltipDuration(offset(-2 * 60_000), NOW)).toBe(
			"2 minutes ago",
		);
	});

	test("compounds days, hours, minutes — drops zero units", () => {
		const ms = 2 * 24 * 60 * 60_000 + 22 * 60 * 60_000 + 35 * 60_000;
		expect(formatTooltipDuration(offset(-ms), NOW)).toBe(
			"2 days, 22 hours, 35 minutes ago",
		);
	});

	test("future timestamps prefix with 'In'", () => {
		const ms = 3 * 24 * 60 * 60_000;
		expect(formatTooltipDuration(offset(ms), NOW)).toBe("In 3 days");
	});
});
