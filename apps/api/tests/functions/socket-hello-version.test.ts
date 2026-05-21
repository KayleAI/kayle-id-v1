import { describe, expect, test } from "bun:test";
import { isAppVersionAtLeast } from "@/v1/verify/socket-hello-version";

describe("isAppVersionAtLeast", () => {
	test("accepts versions newer than or equal to the configured minimum", () => {
		expect(isAppVersionAtLeast("1.4.1", "1.4.1")).toBeTrue();
		expect(isAppVersionAtLeast("1.5.0", "1.4.1")).toBeTrue();
		expect(isAppVersionAtLeast("2.0.0", "1.4.1")).toBeTrue();
	});

	test("rejects older semantic versions", () => {
		expect(isAppVersionAtLeast("1.4.0", "1.4.1")).toBeFalse();
		expect(isAppVersionAtLeast("1.3.9", "1.4.1")).toBeFalse();
		expect(isAppVersionAtLeast("0.9.9", "1.4.1")).toBeFalse();
	});

	test("keeps malformed versions permissive", () => {
		expect(isAppVersionAtLeast("dev", "1.4.1")).toBeTrue();
		expect(isAppVersionAtLeast("1.4.1", "dev")).toBeTrue();
		expect(isAppVersionAtLeast("", "1.4.1")).toBeTrue();
	});
});
