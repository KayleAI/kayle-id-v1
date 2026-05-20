import { Button } from "@kayle-id/ui/components/button";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import type { Organization } from "./types";

const LOCAL_PLATFORM_ORIGIN = "https://localhost:3000";
const STAGING_PLATFORM_ORIGIN = "https://staging.kayle.id";
const PRODUCTION_PLATFORM_ORIGIN = "https://kayle.id";

function getBrowserHostname(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	return window.location.hostname;
}

function getPlatformOrigin(hostname: null | string): string {
	if (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1"
	) {
		return LOCAL_PLATFORM_ORIGIN;
	}

	if (
		hostname?.endsWith(".staging.kayle.id") ||
		hostname === "staging.kayle.id"
	) {
		return STAGING_PLATFORM_ORIGIN;
	}

	return PRODUCTION_PLATFORM_ORIGIN;
}

export function buildOrganizationReportUrl({
	orgId,
	sessionId,
	sourceHostname = getBrowserHostname(),
}: {
	orgId?: string;
	sessionId?: null | string;
	sourceHostname?: null | string;
}): string {
	const url = new URL("/organizations", getPlatformOrigin(sourceHostname));

	if (orgId) {
		url.pathname = `/organizations/${encodeURIComponent(orgId)}/report`;
	}

	if (sessionId) {
		url.searchParams.set("session_id", sessionId);
	}

	return url.toString();
}

export function OrganizationReportAction({
	className,
	organization,
	sessionId,
	variant = "outline",
}: {
	className?: string;
	organization: Organization;
	sessionId?: null | string;
	variant?: "ghost" | "outline";
}) {
	const copy = useVerifyHandoffCopy();

	if (!organization.id) {
		return null;
	}

	return (
		<Button
			className={className}
			render={
				<a
					href={buildOrganizationReportUrl({
						orgId: organization.id,
						sessionId,
					})}
				>
					{copy.org.report.actionLabel}
				</a>
			}
			variant={variant}
		/>
	);
}
