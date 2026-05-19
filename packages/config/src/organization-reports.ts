export const ORGANIZATION_REPORT_REASONS = [
  "impersonation",
  "deceptive_use",
  "privacy_concern",
  "discrimination_or_eligibility_concern",
  "missing_fallback_or_appeal",
  "other",
] as const;

export type OrganizationReportReason =
  (typeof ORGANIZATION_REPORT_REASONS)[number];

export const ORGANIZATION_REPORT_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
] as const;

export type OrganizationReportStatus =
  (typeof ORGANIZATION_REPORT_STATUSES)[number];
