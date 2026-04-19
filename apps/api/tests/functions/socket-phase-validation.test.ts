import { afterEach, expect, test } from "bun:test";
import { shouldRejectSuccessfulFallbackMatch } from "@/v1/verify/socket-phase-validation";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (typeof originalNodeEnv === "string") {
    process.env.NODE_ENV = originalNodeEnv;
    return;
  }

  delete process.env.NODE_ENV;
});

test("blocks successful fallback matches in production", () => {
  process.env.NODE_ENV = "production";

  expect(
    shouldRejectSuccessfulFallbackMatch({
      faceResult: {
        faceScore: 1,
        passed: true,
        usedFallback: true,
      },
    })
  ).toBeTrue();
});

test("allows successful primary matches in production", () => {
  process.env.NODE_ENV = "production";

  expect(
    shouldRejectSuccessfulFallbackMatch({
      faceResult: {
        faceScore: 0.91,
        passed: true,
        usedFallback: false,
      },
    })
  ).toBeFalse();
});

test("allows successful fallback matches outside production", () => {
  process.env.NODE_ENV = "test";

  expect(
    shouldRejectSuccessfulFallbackMatch({
      faceResult: {
        faceScore: 1,
        passed: true,
        usedFallback: true,
      },
    })
  ).toBeFalse();
});
