/**
 * Timestamp formatting helpers shared across the dashboard. The shapes here
 * match the pattern we adopted for audit logs (relative label in the cell,
 * full UTC + local timezone in a hover tooltip):
 *
 *   <1s ago / future  → "Just now"
 *   1–59s             → "5s ago"        / "in 5s"
 *   1–59min           → "12m ago"       / "in 12m"
 *   1–23h             → "3h ago"        / "in 3h"
 *   ≥24h, current yr  → "May 30"
 *   ≥24h, older year  → "Dec 12, 2024"
 *
 * Future timestamps mirror the past form so deadlines/expirations render as
 * "in 3 days" rather than collapsing to "Just now".
 *
 * Use the `<RelativeTime />` component from `@/components/relative-time` for
 * any rendered timestamp; this module exists for tests, for the rare
 * non-rendering caller that needs a string, and as the single source of
 * truth for the formatters the component composes.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const SHORT_DATE_NO_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
});
const SHORT_DATE_WITH_YEAR_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});
const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	month: "short",
	year: "numeric",
});
const TOOLTIP_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});
const TOOLTIP_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hour12: true,
	minute: "2-digit",
	second: "2-digit",
});
const TOOLTIP_DATE_UTC_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	timeZone: "UTC",
	year: "numeric",
});
const TOOLTIP_TIME_UTC_FORMATTER = new Intl.DateTimeFormat("en-US", {
	hour: "2-digit",
	hour12: true,
	minute: "2-digit",
	second: "2-digit",
	timeZone: "UTC",
});

function shortAbsolute(date: Date, now: Date): string {
	return date.getFullYear() === now.getFullYear()
		? SHORT_DATE_NO_YEAR_FORMATTER.format(date)
		: SHORT_DATE_WITH_YEAR_FORMATTER.format(date);
}

/**
 * Compact relative-time label. Past and future are symmetric; the future
 * branch is what makes this safe for invitation-expiry / deletion-deadline
 * timestamps (a previous version collapsed those into "Just now" because
 * `delta < SECOND` covered everything in the future).
 */
export function formatRelative(iso: string, now: Date = new Date()): string {
	const then = new Date(iso);
	const delta = now.getTime() - then.getTime();
	const future = delta < 0;
	const abs = Math.abs(delta);

	if (abs < SECOND) {
		return "Just now";
	}
	if (abs < MINUTE) {
		const value = Math.floor(abs / SECOND);
		return future ? `in ${value}s` : `${value}s ago`;
	}
	if (abs < HOUR) {
		const value = Math.floor(abs / MINUTE);
		return future ? `in ${value}m` : `${value}m ago`;
	}
	if (abs < DAY) {
		const value = Math.floor(abs / HOUR);
		return future ? `in ${value}h` : `${value}h ago`;
	}
	return shortAbsolute(then, now);
}

/**
 * Long-form duration shown as the tooltip header. Drops trailing zero units
 * so a fresh row reads "5 minutes ago" rather than "0 days, 0 hours, 5
 * minutes ago". Future timestamps render with an "In …" prefix.
 */
export function formatTooltipDuration(
	iso: string,
	now: Date = new Date(),
): string {
	const then = new Date(iso);
	const delta = now.getTime() - then.getTime();
	const future = delta < 0;
	const abs = Math.abs(delta);

	if (abs < 5 * SECOND) {
		return "Just now";
	}

	const days = Math.floor(abs / DAY);
	const hours = Math.floor((abs % DAY) / HOUR);
	const minutes = Math.floor((abs % HOUR) / MINUTE);
	const seconds = Math.floor((abs % MINUTE) / SECOND);

	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days} day${days === 1 ? "" : "s"}`);
	}
	if (hours > 0) {
		parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
	}
	if (minutes > 0) {
		parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
	}
	const phrase =
		parts.length === 0
			? `${seconds} second${seconds === 1 ? "" : "s"}`
			: parts.join(", ");
	return future ? `In ${phrase}` : `${phrase} ago`;
}

/**
 * Returns the local timezone's short label (e.g. "PDT", "BST", "GMT+1").
 * Falls back to "Local" if the runtime can't surface one.
 */
export function getLocalTimezoneLabel(now: Date = new Date()): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZoneName: "short",
	}).formatToParts(now);
	return parts.find((p) => p.type === "timeZoneName")?.value ?? "Local";
}

/**
 * "May 10, 2026, 08:11 PM" — the shape the legacy `formatDate` produced.
 * Use only when an absolute string is needed without a tooltip (rare); the
 * `<RelativeTime>` component is the right call almost everywhere.
 */
export function formatAbsolute(iso: string): string {
	return ABSOLUTE_FORMATTER.format(new Date(iso));
}

/**
 * Pre-built parts for `<RelativeTime>`'s tooltip. Returning all of them
 * once keeps the component code small and lets tests assert on the same
 * source-of-truth that the UI renders.
 */
export interface TimestampTooltipParts {
	duration: string;
	localDate: string;
	localTime: string;
	localTimezone: string;
	utcDate: string;
	utcTime: string;
}

export function buildTooltipParts(
	iso: string,
	now: Date = new Date(),
): TimestampTooltipParts {
	const date = new Date(iso);
	return {
		duration: formatTooltipDuration(iso, now),
		localDate: TOOLTIP_DATE_FORMATTER.format(date),
		localTime: TOOLTIP_TIME_FORMATTER.format(date),
		localTimezone: getLocalTimezoneLabel(date),
		utcDate: TOOLTIP_DATE_UTC_FORMATTER.format(date),
		utcTime: TOOLTIP_TIME_UTC_FORMATTER.format(date),
	};
}
