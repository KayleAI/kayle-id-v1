import { describe, expect, test } from "bun:test";
import { constantTimeStringEqual } from "./constant-time";

describe("constantTimeStringEqual", () => {
  test("matches identical strings", () => {
    expect(constantTimeStringEqual("abcdef", "abcdef")).toBe(true);
  });

  test("rejects mismatched strings of equal length", () => {
    expect(constantTimeStringEqual("abcdef", "abcdeg")).toBe(false);
  });

  test("rejects strings of different length", () => {
    expect(constantTimeStringEqual("abcdef", "abc")).toBe(false);
  });
});
