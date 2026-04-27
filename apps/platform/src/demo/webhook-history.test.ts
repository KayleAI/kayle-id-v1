import { expect, test } from "vitest";
import {
	getDemoWebhookHistory,
	getDemoWebhookReceiptId,
	getDemoWebhookReplayReceiptIds,
	getLatestDemoWebhook,
} from "./webhook-history";

const legacyWebhook = {
	body: "legacy",
	delivery_id: "whd_legacy",
	event_type: "verification.attempt.failed" as const,
	received_at: "2026-04-19T10:00:00.000Z",
	signature_header: "sig_legacy",
};

test("getDemoWebhookHistory falls back to the legacy webhook field", () => {
	expect(getDemoWebhookHistory({ webhook: legacyWebhook })).toEqual([
		legacyWebhook,
	]);
	expect(getLatestDemoWebhook({ webhook: legacyWebhook })).toEqual(
		legacyWebhook,
	);
});

test("getDemoWebhookHistory appends the latest webhook when the stored history is stale", () => {
	const newerWebhook = {
		...legacyWebhook,
		body: "newer",
		delivery_id: "whd_newer",
		received_at: "2026-04-19T10:05:00.000Z",
	};

	expect(
		getDemoWebhookHistory({
			webhook: newerWebhook,
			webhooks: [legacyWebhook],
		}),
	).toEqual([legacyWebhook, newerWebhook]);
	expect(
		getLatestDemoWebhook({
			webhook: newerWebhook,
			webhooks: [legacyWebhook],
		}),
	).toEqual(newerWebhook);
});

test("getDemoWebhookReplayReceiptIds flags repeated delivery ids as replays", () => {
	const replayedWebhook = {
		...legacyWebhook,
		received_at: "2026-04-19T10:01:00.000Z",
	};
	const distinctWebhook = {
		...legacyWebhook,
		delivery_id: "whd_distinct",
		received_at: "2026-04-19T10:02:00.000Z",
	};

	expect(
		getDemoWebhookReplayReceiptIds([
			legacyWebhook,
			replayedWebhook,
			distinctWebhook,
		]),
	).toEqual(new Set([getDemoWebhookReceiptId(replayedWebhook)]));
});
