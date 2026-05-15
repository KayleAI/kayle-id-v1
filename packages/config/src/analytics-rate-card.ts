// Cloudflare pricing snapshot. Used by `emitCostEvent` to convert raw
// usage measurements into estimated USD at write time. Each data point
// also stores the rate it was billed at (`double2 = rate_applied`), so
// historical rows stay accurate after we update these constants.
//
// Reconcile against the actual Cloudflare invoice monthly; recalibrate
// the worst-offending resource if the dashboard estimate drifts more
// than ±20% from the real bill.

export const CF_RATE_CARD_LAST_VERIFIED_AT = "2026-05-14";
export const CF_RATE_CARD_SOURCE =
  "https://developers.cloudflare.com/containers/pricing/";

// --- Per-second / per-byte primitives -------------------------------

/** Container vCPU: $20 per million vCPU-seconds. */
export const CF_CONTAINER_VCPU_PER_SECOND_USD = 0.000_02;
/** Container memory: $2.50 per million GiB-seconds. */
export const CF_CONTAINER_MEMORY_PER_GIB_SECOND_USD = 0.000_002_5;
/** Container disk: $0.07 per million GB-seconds. */
export const CF_CONTAINER_DISK_PER_GB_SECOND_USD = 0.000_000_07;

/** Workers requests: $0.30 per million. */
export const CF_WORKERS_REQUEST_PER_REQUEST_USD = 0.000_000_3;
/** Workers CPU duration: $0.02 per million CPU-ms. */
export const CF_WORKERS_CPU_PER_MS_USD = 0.000_000_02;

/** D1 rows read: $0.001 per million. */
export const CF_D1_ROW_READ_USD = 0.000_000_001;
/** D1 rows written: $1.00 per million. */
export const CF_D1_ROW_WRITE_USD = 0.000_001;
/** D1 storage: $0.75 per GB-month. */
export const CF_D1_STORAGE_PER_GB_MONTH_USD = 0.75;

/** R2 Class A ops (PUT, COPY, POST, LIST): $4.50 per million. */
export const CF_R2_CLASS_A_USD = 0.000_004_5;
/** R2 Class B ops (GET, HEAD): $0.36 per million. */
export const CF_R2_CLASS_B_USD = 0.000_000_36;
/** R2 storage: $0.015 per GB-month. */
export const CF_R2_STORAGE_PER_GB_MONTH_USD = 0.015;

/** KV reads: $0.50 per million. */
export const CF_KV_READ_USD = 0.000_000_5;
/** KV writes: $5.00 per million. */
export const CF_KV_WRITE_USD = 0.000_005;
/** KV deletes: $5.00 per million (priced same as writes). */
export const CF_KV_DELETE_USD = 0.000_005;
/** KV lists: $5.00 per million. */
export const CF_KV_LIST_USD = 0.000_005;
/** KV storage: $0.50 per GB-month. */
export const CF_KV_STORAGE_PER_GB_MONTH_USD = 0.5;

/** Durable Objects requests: $0.15 per million. */
export const CF_DO_REQUEST_USD = 0.000_000_15;
/** Durable Objects duration: $12.50 per million GB-seconds. */
export const CF_DO_DURATION_PER_GB_SECOND_USD = 0.000_012_5;
/** Durable Objects storage: $0.20 per GB-month. */
export const CF_DO_STORAGE_PER_GB_MONTH_USD = 0.2;

/** Workflows: priced as Workers (requests + CPU-ms). */
export const CF_WORKFLOW_RUN_USD = CF_WORKERS_REQUEST_PER_REQUEST_USD;

// --- Container instance profile -------------------------------------

/**
 * The instance_type the production verifier container runs on. Update
 * here AND in wrangler.jsonc together; the combined-rate computation
 * below assumes these values match the deployed config.
 */
export const CONTAINER_INSTANCE = {
  type: "standard-3" as const,
  vcpu: 2,
  memoryGib: 8,
  diskGb: 16,
};

/**
 * Combined per-millisecond cost while the verifier container is
 * actively running: vCPU + provisioned memory + provisioned disk.
 * `container_active` events emit `ms` quantities; multiplying by this
 * gives the cost of that running window.
 */
export const CF_CONTAINER_ACTIVE_PER_MS_USD =
  (CONTAINER_INSTANCE.vcpu * CF_CONTAINER_VCPU_PER_SECOND_USD +
    CONTAINER_INSTANCE.memoryGib * CF_CONTAINER_MEMORY_PER_GIB_SECOND_USD +
    CONTAINER_INSTANCE.diskGb * CF_CONTAINER_DISK_PER_GB_SECOND_USD) /
  1000;

// --- Storage-at-rest helpers (cron uses these) ----------------------

const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

/** R2 storage cost per byte-second (derived from $/GB-month). */
export const CF_R2_STORAGE_PER_BYTE_SECOND_USD =
  CF_R2_STORAGE_PER_GB_MONTH_USD / (1_000_000_000 * SECONDS_PER_MONTH);

/** D1 storage cost per byte-second. */
export const CF_D1_STORAGE_PER_BYTE_SECOND_USD =
  CF_D1_STORAGE_PER_GB_MONTH_USD / (1_000_000_000 * SECONDS_PER_MONTH);

/** KV storage cost per byte-second. */
export const CF_KV_STORAGE_PER_BYTE_SECOND_USD =
  CF_KV_STORAGE_PER_GB_MONTH_USD / (1_000_000_000 * SECONDS_PER_MONTH);

/** Durable Objects storage cost per byte-second. */
export const CF_DO_STORAGE_PER_BYTE_SECOND_USD =
  CF_DO_STORAGE_PER_GB_MONTH_USD / (1_000_000_000 * SECONDS_PER_MONTH);

// --- Resource → rate lookup -----------------------------------------

export type ResourceKind =
  | "container_active"
  | "container_idle_estimated"
  | "worker_request"
  | "worker_cpu"
  | "d1_read"
  | "d1_write"
  | "d1_storage_byte_seconds"
  | "r2_class_a"
  | "r2_class_b"
  | "r2_storage_byte_seconds"
  | "kv_read"
  | "kv_write"
  | "kv_delete"
  | "kv_list"
  | "kv_storage_byte_seconds"
  | "do_request"
  | "do_duration_gb_seconds"
  | "do_storage_byte_seconds"
  | "workflow_run";

export interface ResourceRate {
  /** Documented unit for the rate. Sanity / debugging only. */
  readonly unit:
    | "ms"
    | "operation"
    | "request"
    | "row"
    | "byte_second"
    | "gb_second";
  /** Multiplier applied to the event's `quantity` to get USD. */
  readonly usdPerUnit: number;
}

export const CF_RATE_CARD: Record<ResourceKind, ResourceRate> = {
  container_active: {
    usdPerUnit: CF_CONTAINER_ACTIVE_PER_MS_USD,
    unit: "ms",
  },
  container_idle_estimated: {
    usdPerUnit: CF_CONTAINER_ACTIVE_PER_MS_USD,
    unit: "ms",
  },
  worker_request: {
    usdPerUnit: CF_WORKERS_REQUEST_PER_REQUEST_USD,
    unit: "request",
  },
  worker_cpu: { usdPerUnit: CF_WORKERS_CPU_PER_MS_USD, unit: "ms" },
  d1_read: { usdPerUnit: CF_D1_ROW_READ_USD, unit: "row" },
  d1_write: { usdPerUnit: CF_D1_ROW_WRITE_USD, unit: "row" },
  d1_storage_byte_seconds: {
    usdPerUnit: CF_D1_STORAGE_PER_BYTE_SECOND_USD,
    unit: "byte_second",
  },
  r2_class_a: { usdPerUnit: CF_R2_CLASS_A_USD, unit: "operation" },
  r2_class_b: { usdPerUnit: CF_R2_CLASS_B_USD, unit: "operation" },
  r2_storage_byte_seconds: {
    usdPerUnit: CF_R2_STORAGE_PER_BYTE_SECOND_USD,
    unit: "byte_second",
  },
  kv_read: { usdPerUnit: CF_KV_READ_USD, unit: "operation" },
  kv_write: { usdPerUnit: CF_KV_WRITE_USD, unit: "operation" },
  kv_delete: { usdPerUnit: CF_KV_DELETE_USD, unit: "operation" },
  kv_list: { usdPerUnit: CF_KV_LIST_USD, unit: "operation" },
  kv_storage_byte_seconds: {
    usdPerUnit: CF_KV_STORAGE_PER_BYTE_SECOND_USD,
    unit: "byte_second",
  },
  do_request: { usdPerUnit: CF_DO_REQUEST_USD, unit: "request" },
  do_duration_gb_seconds: {
    usdPerUnit: CF_DO_DURATION_PER_GB_SECOND_USD,
    unit: "gb_second",
  },
  do_storage_byte_seconds: {
    usdPerUnit: CF_DO_STORAGE_PER_BYTE_SECOND_USD,
    unit: "byte_second",
  },
  workflow_run: { usdPerUnit: CF_WORKFLOW_RUN_USD, unit: "request" },
};

export function rateForResource(resource: ResourceKind): ResourceRate {
  return CF_RATE_CARD[resource];
}
