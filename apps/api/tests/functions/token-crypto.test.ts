import { expect, test } from "bun:test";
import { constantTimeStringEqual } from "@/v1/verify/token-crypto";

test("constantTimeStringEqual matches identical strings", () => {
	expect(constantTimeStringEqual("abcdef", "abcdef")).toBe(true);
});

test("constantTimeStringEqual rejects different strings with the same length", () => {
	expect(constantTimeStringEqual("abcdef", "abcdeg")).toBe(false);
});

test("constantTimeStringEqual rejects strings with different lengths", () => {
	expect(constantTimeStringEqual("abcdef", "abc")).toBe(false);
});
