import { describe, expect, mock, test } from "bun:test";
import { type DohFetch, lookupTxt } from "./doh";

function buildJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/dns-json" },
    status,
  });
}

describe("lookupTxt", () => {
  test("returns parsed values from a hit", async () => {
    const fetchMock: DohFetch = mock(async () =>
      buildJsonResponse({
        Status: 0,
        Answer: [
          {
            name: "_kayle-id-verification.acme.co.",
            type: 16,
            data: '"kayle-id-verification=abc123"',
          },
        ],
      })
    );

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.acme.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({
      ok: true,
      values: ["kayle-id-verification=abc123"],
    });
  });

  test("concatenates multi-string TXT chunks", async () => {
    const fetchMock: DohFetch = mock(async () =>
      buildJsonResponse({
        Status: 0,
        Answer: [{ type: 16, data: '"kayle-id-" "verification=abc123"' }],
      })
    );

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.acme.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({
      ok: true,
      values: ["kayle-id-verification=abc123"],
    });
  });

  test("returns no_record on NXDOMAIN", async () => {
    const fetchMock: DohFetch = mock(async () =>
      buildJsonResponse({ Status: 3 })
    );

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.missing.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({ ok: false, reason: "no_record" });
  });

  test("returns no_record when Answer array is empty", async () => {
    const fetchMock: DohFetch = mock(async () =>
      buildJsonResponse({ Status: 0, Answer: [] })
    );

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.acme.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({ ok: false, reason: "no_record" });
  });

  test("falls back on primary network error then returns fallback result", async () => {
    let call = 0;
    const fetchMock: DohFetch = mock((..._args: Parameters<DohFetch>) => {
      call += 1;
      if (call === 1) {
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(
        buildJsonResponse({
          Status: 0,
          Answer: [{ type: 16, data: '"kayle-id-verification=zzz"' }],
        })
      );
    });

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.acme.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({
      ok: true,
      values: ["kayle-id-verification=zzz"],
    });
    expect(call).toBe(2);
  });

  test("does not fall back when primary returns a clean miss", async () => {
    let call = 0;
    const fetchMock: DohFetch = mock((..._args: Parameters<DohFetch>) => {
      call += 1;
      return Promise.resolve(buildJsonResponse({ Status: 3 }));
    });

    const outcome = await lookupTxt({
      recordName: "_kayle-id-verification.acme.co",
      fetchImpl: fetchMock,
    });

    expect(outcome).toEqual({ ok: false, reason: "no_record" });
    expect(call).toBe(1);
  });
});
