// Per-event cost telemetry into Cloudflare Analytics Engine.
//
// Every cost-bearing call site (D1 query, R2 op, KV op, container
// /verify, DO request, …) calls `emitCostEvent` with a raw `quantity`
// (ms, ops, bytes). The helper multiplies through the rate card and
// writes one data point with both the raw quantity AND the estimated
// USD, so dashboard SUMs are cheap and historical rates stay correct.
//
// Mirrors the non-blocking shape of `logEvent` in `./logging` —
// failures are swallowed; nothing in the request path should ever
// fault because of a cost-attribution write.

import {
  type ResourceKind,
  type ResourceRate,
  rateForResource,
} from "./analytics-rate-card";

/**
 * Minimal subset of the Cloudflare AnalyticsEngineDataset binding API.
 * The real `AnalyticsEngineDataset` type from `@cloudflare/workers-types`
 * matches this shape; we redeclare locally so this module compiles in
 * non-Workers test contexts too.
 */
export interface AnalyticsEngineDatasetLike {
  writeDataPoint(payload: {
    indexes?: readonly string[];
    blobs?: readonly string[];
    doubles?: readonly number[];
  }): void;
}

/**
 * Standardised feature labels. New flows add a constant here so the
 * dashboard's stacked-bar legend stays stable. Free-form strings would
 * splinter into typo'd variants over time.
 */
export const COST_FEATURES = {
  Verify: "verify",
  WebhookDelivery: "webhook_delivery",
  OrgAdmin: "org_admin",
  PlatformAdmin: "platform_admin",
  PublicVerifySession: "public_verify_session",
  ApiKeys: "api_keys",
  StorageCron: "storage_cron",
  Unknown: "unknown",
} as const;

export type CostFeature = (typeof COST_FEATURES)[keyof typeof COST_FEATURES];

export interface EmitCostEventInput {
  /** Verify-flow trace identifier when applicable. */
  readonly attemptId?: string | null;
  /** The `KAYLE_ID_ANALYTICS` binding from `env`. Missing → no-op. */
  readonly dataset: AnalyticsEngineDatasetLike | undefined | null;
  /** Logical feature/flow this cost is part of (see COST_FEATURES). */
  readonly feature: CostFeature;
  /** Per-tenant attribution. Falls back to `_unattributed`. */
  readonly organizationId?: string | null;
  /** Raw measurement (ms, ops, bytes — depends on resource). */
  readonly quantity: number;
  /** Which CF surface produced the cost. */
  readonly resource: ResourceKind;
  /** Sanity label for the raw unit; not used in cost math. */
  readonly unit: string;
  /** Worker that emitted the event (`kayle-id-api`, etc.). */
  readonly workerName: string;
}

/**
 * Emit one cost event. Computes estimated USD via the rate card and
 * writes a single data point. No-op if `dataset` is missing or the
 * write throws (best-effort; never fails the caller).
 */
export function emitCostEvent(input: EmitCostEventInput): void {
  if (!input.dataset) {
    return;
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 0) {
    return;
  }

  const rate: ResourceRate = rateForResource(input.resource);
  const estimatedCostUsd = input.quantity * rate.usdPerUnit;

  try {
    input.dataset.writeDataPoint({
      indexes: [
        input.organizationId && input.organizationId.length > 0
          ? input.organizationId
          : "_unattributed",
      ],
      blobs: [
        input.feature,
        input.resource,
        input.workerName,
        input.unit,
        input.attemptId ?? "",
      ],
      doubles: [input.quantity, rate.usdPerUnit, estimatedCostUsd],
    });
  } catch {
    // Best-effort; analytics writes must never fail the request path.
  }
}

/**
 * Resolve the dataset binding from a Workers env object. The dataset
 * may be missing in test runtimes or local dev — that's fine, every
 * call site treats `null` as "skip".
 */
export function resolveAnalyticsDataset(
  env: unknown
): AnalyticsEngineDatasetLike | null {
  if (!(env && typeof env === "object")) {
    return null;
  }
  const candidate = Reflect.get(env, "KAYLE_ID_ANALYTICS");
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const write = Reflect.get(candidate, "writeDataPoint");
  return typeof write === "function"
    ? (candidate as AnalyticsEngineDatasetLike)
    : null;
}
