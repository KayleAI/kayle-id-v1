import { describe, expect, it } from "bun:test";
import { shouldRunStorageAtRest } from "./storage-at-rest";

describe("shouldRunStorageAtRest", () => {
	it("fires at exactly midnight UTC", () => {
		const t = Date.UTC(2026, 0, 15, 0, 0, 0);
		expect(shouldRunStorageAtRest(t)).toBe(true);
	});

	it("fires within the first ~90 seconds of the day", () => {
		const t = Date.UTC(2026, 0, 15, 0, 1, 0);
		expect(shouldRunStorageAtRest(t)).toBe(true);
	});

	it("skips later in the 00:00 hour", () => {
		const t = Date.UTC(2026, 0, 15, 0, 5, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});

	it("skips every other hour", () => {
		const t = Date.UTC(2026, 0, 15, 12, 0, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});

	it("skips 23:59 of the prior day", () => {
		const t = Date.UTC(2026, 0, 14, 23, 59, 0);
		expect(shouldRunStorageAtRest(t)).toBe(false);
	});
});
