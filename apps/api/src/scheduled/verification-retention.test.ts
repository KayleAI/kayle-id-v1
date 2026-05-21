import { describe, expect, test } from "bun:test";
import { shouldRunVerificationRetentionSweep } from "./verification-retention";

describe("shouldRunVerificationRetentionSweep", () => {
	test("matches the configured UTC retention sweep minute", () => {
		expect(
			shouldRunVerificationRetentionSweep(
				new Date(Date.UTC(2026, 4, 21, 2, 23, 0)),
			),
		).toBeTrue();
	});

	test("accepts scheduled timestamps as numbers", () => {
		const scheduledTime = Date.UTC(2026, 4, 21, 2, 23, 45);

		expect(shouldRunVerificationRetentionSweep(scheduledTime)).toBeTrue();
	});

	test("rejects other UTC minutes", () => {
		expect(
			shouldRunVerificationRetentionSweep(
				new Date(Date.UTC(2026, 4, 21, 2, 22, 59)),
			),
		).toBeFalse();
		expect(
			shouldRunVerificationRetentionSweep(
				new Date(Date.UTC(2026, 4, 21, 2, 24, 0)),
			),
		).toBeFalse();
	});
});
