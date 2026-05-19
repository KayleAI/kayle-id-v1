import type {
	OrganizationReportReason,
	OrganizationReportStatus,
} from "@kayle-id/config/organization-reports";

export const ORGANIZATION_REPORT_REASON_LABELS: Record<
	OrganizationReportReason,
	string
> = {
	deceptive_use: "Deceptive use",
	discrimination_or_eligibility_concern:
		"Discrimination or eligibility concern",
	impersonation: "Impersonation",
	missing_fallback_or_appeal: "No fallback or appeal route",
	other: "Other",
	privacy_concern: "Privacy concern",
};

export const ORGANIZATION_REPORT_STATUS_LABELS: Record<
	OrganizationReportStatus,
	string
> = {
	dismissed: "Dismissed",
	investigating: "Investigating",
	open: "Open",
	resolved: "Resolved",
};
