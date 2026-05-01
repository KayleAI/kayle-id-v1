import { describe, expect, test } from "bun:test";
import { createMagicVerifyLinkPath } from "./client";

describe("createMagicVerifyLinkPath", () => {
  test("encodes token and callback query parameters", () => {
    expect(
      createMagicVerifyLinkPath({
        callbackURL: "/dashboard?next=/settings&from=email",
        token: "token+with/symbols",
      })
    ).toBe(
      "/magic/verify-link?token=token%2Bwith%2Fsymbols&callbackURL=%2Fdashboard%3Fnext%3D%2Fsettings%26from%3Demail"
    );
  });

  test("omits callbackURL when none is provided", () => {
    expect(createMagicVerifyLinkPath({ token: "token" })).toBe(
      "/magic/verify-link?token=token"
    );
  });
});
