import { expect, test } from "bun:test";
import { isPhaseAtOrAfter } from "@/v1/verify/phase-state";

test("returns false for null current phase", () => {
	expect(isPhaseAtOrAfter(null, "nfc_reading")).toBeFalse();
});

test("returns false for unknown phase strings", () => {
	expect(isPhaseAtOrAfter("not_a_phase", "nfc_reading")).toBeFalse();
});

test("returns false when candidate is before the reference", () => {
	expect(isPhaseAtOrAfter("mrz_complete", "nfc_reading")).toBeFalse();
});

test("returns true when candidate equals the reference", () => {
	expect(isPhaseAtOrAfter("nfc_reading", "nfc_reading")).toBeTrue();
});

test("returns true when candidate is past the reference", () => {
	expect(isPhaseAtOrAfter("nfc_complete", "nfc_reading")).toBeTrue();
	expect(isPhaseAtOrAfter("selfie_capturing", "nfc_reading")).toBeTrue();
	expect(isPhaseAtOrAfter("selfie_complete", "nfc_reading")).toBeTrue();
});

test("selfie reference rejects phases before selfie_capturing", () => {
	expect(isPhaseAtOrAfter("nfc_complete", "selfie_capturing")).toBeFalse();
});
