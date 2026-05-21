import { logEvent, logSafeError } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";

const DATE_PAD_LENGTH = 2;

function formatRunDay(now: Date): string {
	const year = now.getUTCFullYear().toString().padStart(4, "0");
	const month = (now.getUTCMonth() + 1)
		.toString()
		.padStart(DATE_PAD_LENGTH, "0");
	const day = now.getUTCDate().toString().padStart(DATE_PAD_LENGTH, "0");
	return `${year}-${month}-${day}`;
}

function isMissingDedupeTableError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return message.toLowerCase().includes("no such table");
}

export async function claimDailyEmissionSlot({
	env,
	now,
	logger,
}: {
	env: CloudflareBindings;
	now: Date;
	logger?: ApiRequestLogger;
}): Promise<boolean> {
	const runDay = formatRunDay(now);
	try {
		const result = await env.TRUST_STORE.prepare(
			"INSERT INTO storage_at_rest_runs (run_day, completed_at_ms) VALUES (?, ?) ON CONFLICT(run_day) DO NOTHING",
		)
			.bind(runDay, now.getTime())
			.run();
		const inserted = (result.meta?.changes ?? 0) > 0;
		if (!inserted) {
			logEvent(logger, {
				details: { run_day: runDay },
				event: "storage_at_rest.skipped_already_ran",
			});
		}
		return inserted;
	} catch (error) {
		if (isMissingDedupeTableError(error)) {
			logSafeError(logger, {
				code: "storage_at_rest_dedupe_table_missing",
				details: { run_day: runDay },
				error,
				event: "storage_at_rest.dedupe_table_missing",
				message:
					"storage_at_rest_runs table is missing — apply migration 0002_storage_at_rest_runs.sql to this env.",
			});
			return false;
		}

		logSafeError(logger, {
			code: "storage_at_rest_dedupe_failed",
			details: { run_day: runDay },
			error,
			event: "storage_at_rest.dedupe_failed",
			message:
				"storage-at-rest dedupe insert failed; skipping emission to avoid duplicate counting.",
		});
		return false;
	}
}
