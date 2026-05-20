import type { ReactNode } from "react";
import type { useVerifyHandoffCopy } from "@/i18n/provider";
import type { Organization } from "@/screens/organization/types";
import { toOrganization } from "@/screens/organization/types";
import type { PrivacyRequestRouteContext } from "./types";

type PrivacyCopy = ReturnType<typeof useVerifyHandoffCopy>["privacyRequest"];

export function buildPrivacyRequestPath({
	cancelToken,
	sessionId,
}: {
	cancelToken: string | null;
	sessionId: string;
}): string {
	const path = `/${encodeURIComponent(sessionId)}/privacy`;
	if (!cancelToken) {
		return path;
	}

	const params = new URLSearchParams({ cancel_token: cancelToken });
	return `${path}?${params.toString()}`;
}

export function buildPrivacyRequestMailtoHref({
	email,
	organizationName,
	sessionId,
}: {
	email: string;
	organizationName: string | null;
	sessionId: string;
}): string {
	const lines = [
		"I am using the Kayle ID privacy options for this check.",
		"",
		"Request type: withdrawal, deletion, or data access",
		`Session ID: ${sessionId}`,
		`Organization: ${organizationName ?? "not available"}`,
		"",
		"I do not have a Kayle ID account for this check.",
		"",
		"Request details:",
	];
	const subject = `Kayle ID privacy options for ${sessionId}`;
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export function getPrivacyOrganization(
	context: PrivacyRequestRouteContext,
): Organization | null {
	if (context.kind !== "found" || context.organization_name === null) {
		return null;
	}
	return toOrganization(context);
}

export function getFoundPageDescription({
	context,
	copy,
	hasOrganization,
}: {
	context: Extract<PrivacyRequestRouteContext, { kind: "found" }>;
	copy: PrivacyCopy;
	hasOrganization: boolean;
}): string {
	if (!context.is_terminal) {
		return hasOrganization
			? copy.activeDescription
			: copy.unavailableActiveDescription;
	}
	if (context.result_webhook_deliveries.succeeded_count > 0) {
		return copy.terminalDeliveredDescription;
	}
	if (context.result_webhook_deliveries.undelivered_count > 0) {
		return copy.terminalUndeliveredDescription;
	}
	return copy.terminalNoDataDescription;
}

const ORG_PLACEHOLDER = "{organization}";

export function renderOrganizationText({
	dim = false,
	organization,
	organizationLabel,
	template,
	renderOrganization,
}: {
	dim?: boolean;
	organization: Organization | null;
	organizationLabel: string;
	template: string;
	renderOrganization: (params: {
		dim: boolean;
		organization: Organization;
	}) => ReactNode;
}): ReactNode {
	const placeholderIndex = template.indexOf(ORG_PLACEHOLDER);
	if (placeholderIndex === -1) {
		return template;
	}

	const before = template.slice(0, placeholderIndex);
	const after = template.slice(placeholderIndex + ORG_PLACEHOLDER.length);
	const node = organization
		? renderOrganization({ dim, organization })
		: organizationLabel;

	return (
		<>
			{before}
			{node}
			{after}
		</>
	);
}
