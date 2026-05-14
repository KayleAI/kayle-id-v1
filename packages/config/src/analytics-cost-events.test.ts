import { describe, expect, it } from "bun:test";
import {
  COST_FEATURES,
  emitCostEvent,
  resolveAnalyticsDataset,
} from "./analytics-cost-events";
import {
  CF_CONTAINER_ACTIVE_PER_MS_USD,
  CF_D1_ROW_READ_USD,
  CF_KV_WRITE_USD,
  CF_R2_CLASS_A_USD,
  CF_RATE_CARD,
  rateForResource,
} from "./analytics-rate-card";

describe("rate card", () => {
  it("covers every ResourceKind", () => {
    // Every value in CF_RATE_CARD has a finite positive rate
    for (const [resource, rate] of Object.entries(CF_RATE_CARD)) {
      expect(rate.usdPerUnit).toBeGreaterThan(0);
      expect(Number.isFinite(rate.usdPerUnit)).toBe(true);
      expect(typeof rate.unit).toBe("string");
      expect(resource.length).toBeGreaterThan(0);
    }
  });

  it("computes container_active rate from instance components", () => {
    // standard-3 = 2 vCPU + 8 GiB + 16 GB disk
    // sanity: result is a tiny positive number (cents-per-second range)
    expect(CF_CONTAINER_ACTIVE_PER_MS_USD).toBeGreaterThan(0);
    expect(CF_CONTAINER_ACTIVE_PER_MS_USD).toBeLessThan(0.001);
    // 1s of container_active should cost ~$0.0001 (sanity-check the math)
    expect(CF_CONTAINER_ACTIVE_PER_MS_USD * 1000).toBeCloseTo(
      2 * 0.000_02 + 8 * 0.000_002_5 + 16 * 0.000_000_07,
      9
    );
  });

  it("resolves rates by ResourceKind", () => {
    expect(rateForResource("d1_read").usdPerUnit).toBe(CF_D1_ROW_READ_USD);
    expect(rateForResource("kv_write").usdPerUnit).toBe(CF_KV_WRITE_USD);
    expect(rateForResource("r2_class_a").usdPerUnit).toBe(CF_R2_CLASS_A_USD);
  });
});

interface CapturedDataPoint {
  blobs?: readonly string[];
  doubles?: readonly number[];
  indexes?: readonly string[];
}

function captureDataset(): {
  dataset: { writeDataPoint: (payload: CapturedDataPoint) => void };
  calls: CapturedDataPoint[];
} {
  const calls: CapturedDataPoint[] = [];
  return {
    dataset: {
      writeDataPoint: (payload: CapturedDataPoint) => {
        calls.push(payload);
      },
    },
    calls,
  };
}

describe("emitCostEvent", () => {
  it("writes one data point with computed cost", () => {
    const { dataset, calls } = captureDataset();

    emitCostEvent({
      dataset,
      organizationId: "org-123",
      feature: COST_FEATURES.Verify,
      resource: "container_active",
      quantity: 3400, // 3.4s in ms
      unit: "ms",
      workerName: "kayle-id-biometric-verifier",
      attemptId: "attempt-abc",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0] as CapturedDataPoint;
    expect(call.indexes).toEqual(["org-123"]);
    expect(call.blobs).toEqual([
      "verify",
      "container_active",
      "kayle-id-biometric-verifier",
      "ms",
      "attempt-abc",
    ]);
    expect(call.doubles?.[0]).toBe(3400);
    expect(call.doubles?.[1]).toBe(CF_CONTAINER_ACTIVE_PER_MS_USD);
    expect(call.doubles?.[2]).toBeCloseTo(
      3400 * CF_CONTAINER_ACTIVE_PER_MS_USD,
      12
    );
  });

  it("falls back to _unattributed when organizationId is missing", () => {
    const { dataset, calls } = captureDataset();
    emitCostEvent({
      dataset,
      feature: COST_FEATURES.StorageCron,
      resource: "r2_storage_byte_seconds",
      quantity: 1_000_000,
      unit: "byte_second",
      workerName: "kayle-id-api",
    });
    expect(calls).toHaveLength(1);
    const call = calls[0] as CapturedDataPoint;
    expect(call.indexes).toEqual(["_unattributed"]);
  });

  it("no-ops when dataset binding is missing", () => {
    // Just verifying nothing throws
    emitCostEvent({
      dataset: null,
      feature: COST_FEATURES.Verify,
      resource: "d1_read",
      quantity: 5,
      unit: "row",
      workerName: "kayle-id-api",
    });
    emitCostEvent({
      dataset: undefined,
      feature: COST_FEATURES.Verify,
      resource: "d1_read",
      quantity: 5,
      unit: "row",
      workerName: "kayle-id-api",
    });
  });

  it("no-ops on negative or non-finite quantities", () => {
    const { dataset, calls } = captureDataset();
    emitCostEvent({
      dataset,
      feature: COST_FEATURES.Verify,
      resource: "d1_read",
      quantity: -5,
      unit: "row",
      workerName: "kayle-id-api",
    });
    emitCostEvent({
      dataset,
      feature: COST_FEATURES.Verify,
      resource: "d1_read",
      quantity: Number.NaN,
      unit: "row",
      workerName: "kayle-id-api",
    });
    expect(calls).toHaveLength(0);
  });

  it("swallows writeDataPoint exceptions", () => {
    let writeCount = 0;
    const dataset = {
      writeDataPoint() {
        writeCount += 1;
        throw new Error("analytics engine unavailable");
      },
    };
    // Must not throw
    emitCostEvent({
      dataset,
      feature: COST_FEATURES.Verify,
      resource: "d1_read",
      quantity: 1,
      unit: "row",
      workerName: "kayle-id-api",
    });
    expect(writeCount).toBe(1);
  });
});

describe("resolveAnalyticsDataset", () => {
  it("returns the dataset when bound", () => {
    const dataset = {
      writeDataPoint: () => {
        // no-op for binding-shape test
      },
    };
    expect(resolveAnalyticsDataset({ KAYLE_ID_ANALYTICS: dataset })).toBe(
      dataset
    );
  });

  it("returns null when binding absent or shape wrong", () => {
    expect(resolveAnalyticsDataset({})).toBeNull();
    expect(resolveAnalyticsDataset(null)).toBeNull();
    expect(resolveAnalyticsDataset(undefined)).toBeNull();
    expect(
      resolveAnalyticsDataset({ KAYLE_ID_ANALYTICS: "not-a-dataset" })
    ).toBeNull();
    expect(
      resolveAnalyticsDataset({
        KAYLE_ID_ANALYTICS: { writeDataPoint: "nope" },
      })
    ).toBeNull();
  });
});
