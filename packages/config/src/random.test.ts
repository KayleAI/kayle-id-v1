import { describe, expect, test } from "bun:test";
import { generateRandomString } from "./random";

const DEFAULT_RANDOM_STRING_REGEX = /^[a-z0-9]{64}$/;
const BINARY_RANDOM_STRING_REGEX = /^[ab]{24}$/;

describe("generateRandomString", () => {
  test("generates lowercase base36 strings with the requested length", () => {
    expect(generateRandomString(64)).toMatch(DEFAULT_RANDOM_STRING_REGEX);
  });

  test("supports a caller-supplied alphabet", () => {
    expect(generateRandomString(24, "ab")).toMatch(BINARY_RANDOM_STRING_REGEX);
  });

  test("rejects invalid lengths and alphabets", () => {
    expect(() => generateRandomString(-1)).toThrow("random_length_invalid");
    expect(() => generateRandomString(1.5)).toThrow("random_length_invalid");
    expect(() => generateRandomString(1, "a")).toThrow(
      "random_alphabet_invalid"
    );
  });
});
