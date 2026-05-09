import { expect, test } from "bun:test";
import {
	constantTimeStringEqual,
	generateSessionCancelToken,
	SESSION_CANCEL_TOKEN_LENGTH,
	SESSION_CANCEL_TOKEN_PATTERN,
} from "@/v1/verify/token-crypto";

test("constantTimeStringEqual matches identical strings", () => {
	expect(constantTimeStringEqual("abcdef", "abcdef")).toBe(true);
});

test("constantTimeStringEqual rejects different strings with the same length", () => {
	expect(constantTimeStringEqual("abcdef", "abcdeg")).toBe(false);
});

test("constantTimeStringEqual rejects strings with different lengths", () => {
	expect(constantTimeStringEqual("abcdef", "abc")).toBe(false);
});

test("generateSessionCancelToken follows the public cancel-token schema", () => {
	const token = generateSessionCancelToken();

	expect(token.length).toBe(SESSION_CANCEL_TOKEN_LENGTH);
	expect(token).toMatch(SESSION_CANCEL_TOKEN_PATTERN);
});
