import { afterEach, describe, expect, test, vi } from "vitest";
import { getSessionAnalyticsOverview } from "./api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockJsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

describe("dashboard analytics api", () => {
  test("requests the session overview endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse({
        data: {
          summary: {
            total: 10,
            active: 1,
            success: 6,
            failure: 2,
            expired: 1,
            cancelled: 0,
          },
          trend: [
            {
              date: "2026-03-21",
              success: 2,
              failure: 1,
              expired: 0,
              cancelled: 0,
            },
          ],
          timeline: [
            {
              date: "2026-03-21",
              total: 10,
              active: 1,
              success: 6,
              failure: 2,
              expired: 1,
              cancelled: 0,
            },
          ],
        },
        error: null,
      })
    );

    globalThis.fetch = fetchMock as typeof fetch;

    await expect(getSessionAnalyticsOverview()).resolves.toEqual({
      summary: {
        total: 10,
        active: 1,
        success: 6,
        failure: 2,
        expired: 1,
        cancelled: 0,
      },
      trend: [
        {
          date: "2026-03-21",
          success: 2,
          failure: 1,
          expired: 0,
          cancelled: 0,
        },
      ],
      timeline: [
        {
          date: "2026-03-21",
          total: 10,
          active: 1,
          success: 6,
          failure: 2,
          expired: 1,
          cancelled: 0,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/sessions/overview",
      expect.objectContaining({
        credentials: "include",
        method: "GET",
      })
    );
  });
});
