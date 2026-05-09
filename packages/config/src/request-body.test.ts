import { describe, expect, test } from "bun:test";
import {
  isRequestBodyTooLarge,
  readRequestJsonWithLimit,
  readRequestTextWithLimit,
} from "./request-body";

async function isRejectedAsRequestBodyTooLarge(
  promise: Promise<unknown>
): Promise<boolean> {
  try {
    await promise;
    return false;
  } catch (error) {
    return isRequestBodyTooLarge(error);
  }
}

describe("request body limits", () => {
  test("reads text bodies within the byte limit", async () => {
    await expect(
      readRequestTextWithLimit(
        new Request("https://kayle.test", {
          body: "hello",
          method: "POST",
        }),
        5
      )
    ).resolves.toBe("hello");
  });

  test("rejects content-length larger than the byte limit before reading", async () => {
    await expect(
      isRejectedAsRequestBodyTooLarge(
        readRequestTextWithLimit(
          new Request("https://kayle.test", {
            body: "small",
            headers: {
              "content-length": "6",
            },
            method: "POST",
          }),
          5
        )
      )
    ).resolves.toBe(true);
  });

  test("rejects streamed bodies once they exceed the byte limit", async () => {
    await expect(
      isRejectedAsRequestBodyTooLarge(
        readRequestTextWithLimit(
          new Request("https://kayle.test", {
            body: "too large",
            method: "POST",
          }),
          3
        )
      )
    ).resolves.toBe(true);
  });

  test("parses JSON bodies within the byte limit", async () => {
    await expect(
      readRequestJsonWithLimit<{ ok: boolean }>(
        new Request("https://kayle.test", {
          body: JSON.stringify({ ok: true }),
          method: "POST",
        }),
        32
      )
    ).resolves.toEqual({ ok: true });
  });
});
