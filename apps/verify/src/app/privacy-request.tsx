import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayleai/ui/button";
import { Logo } from "@kayleai/ui/logo";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { requestCancelVerifySession } from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { type Organization, OrganizationName } from "./app/organization-name";
import { getPlatformNameLabel } from "./app/platform-name";

export type PrivacyRequestRouteContext =
	| {
			kind: "found";
			session_id: string;
			status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
			is_terminal: boolean;
			has_withdrawn_consent: boolean;
			organization_name: string | null;
			organization_owner_id_check_completed: boolean;
			organization_verified_apex_domains: string[];
			organization_logo: string | null;
			organization_business_type: "sole" | "business" | null;
			organization_business_name: string | null;
			organization_business_jurisdiction: string | null;
			organization_business_registration_number: string | null;
			organization_privacy_policy_url: string | null;
			organization_terms_of_service_url: string | null;
			organization_website: string | null;
			organization_description: string | null;
			rp_fallback: {
				appeal_url: string | null;
				complaints_url: string | null;
				fallback_idv_url: string | null;
				support_email: string | null;
			};
			latest_attempt_id: string | null;
			result_webhook_deliveries: {
				total_count: number;
				succeeded_count: number;
				undelivered_count: number;
			};
	  }
	| {
			kind: "not_found";
			session_id: string;
	  };

type PrivacyRequestMailtoInput = {
	attemptId: string | null;
	email: string;
	organizationName: string | null;
	sessionId: string;
};

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
	attemptId,
	email,
	organizationName,
	sessionId,
}: PrivacyRequestMailtoInput): string {
	const lines = [
		"I am using the Kayle ID privacy options for this check.",
		"",
		"Request type: withdrawal, deletion, or data access",
		`Session ID: ${sessionId}`,
		`Latest attempt ID: ${attemptId ?? "not available"}`,
		`Organization: ${organizationName ?? "not available"}`,
		"",
		"I do not have a Kayle ID account for this check.",
		"",
		"Request details:",
	];
	const subject = `Kayle ID privacy options for ${sessionId}`;
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

function getFoundPageDescription({
	context,
	copy,
	hasOrganization,
}: {
	context: Extract<PrivacyRequestRouteContext, { kind: "found" }>;
	copy: ReturnType<typeof useVerifyHandoffCopy>["privacyRequest"];
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

function getPrivacyOrganization(
	context: PrivacyRequestRouteContext,
): Organization | null {
	if (context.kind !== "found" || context.organization_name === null) {
		return null;
	}

	return {
		name: context.organization_name,
		ownerIdCheckCompleted: context.organization_owner_id_check_completed,
		verifiedApexDomains: context.organization_verified_apex_domains,
		logo: context.organization_logo,
		businessType: context.organization_business_type,
		businessName: context.organization_business_name,
		businessJurisdiction: context.organization_business_jurisdiction,
		businessRegistrationNumber:
			context.organization_business_registration_number,
		privacyPolicyUrl: context.organization_privacy_policy_url,
		termsOfServiceUrl: context.organization_terms_of_service_url,
		website: context.organization_website,
		description: context.organization_description,
		rpFallback: {
			appealUrl: context.rp_fallback.appeal_url,
			complaintsUrl: context.rp_fallback.complaints_url,
			fallbackIdvUrl: context.rp_fallback.fallback_idv_url,
			supportEmail: context.rp_fallback.support_email,
		},
	};
}

function renderOrganizationText({
	dim = false,
	organization,
	organizationLabel,
	template,
}: {
	dim?: boolean;
	organization: Organization | null;
	organizationLabel: string;
	template: string;
}): ReactNode {
	const placeholderIndex = template.indexOf("{organization}");
	if (placeholderIndex === -1) {
		return template;
	}

	const before = template.slice(0, placeholderIndex);
	const after = template.slice(placeholderIndex + "{organization}".length);
	const organizationNode = organization ? (
		<OrganizationName dim={dim} organization={organization} />
	) : (
		organizationLabel
	);

	return (
		<>
			{before}
			{organizationNode}
			{after}
		</>
	);
}

export function PrivacyRequestPage({
	cancelToken,
	context,
}: {
	cancelToken: string | null;
	context: PrivacyRequestRouteContext;
}) {
	const copy = useVerifyHandoffCopy();
	const privacyCopy = copy.privacyRequest;
	const [cancelState, setCancelState] = useState<
		"idle" | "pending" | "succeeded" | "failed"
	>("idle");
	const isFound = context.kind === "found";
	const hasOrganization = isFound && context.organization_name !== null;
	const sessionId = context.session_id;
	const organization = getPrivacyOrganization(context);
	const organizationLabel = hasOrganization
		? getPlatformNameLabel(context.organization_name)
		: privacyCopy.defaultOrganizationName;
	const rpMailtoHref = useMemo(() => {
		if (!isFound) {
			return null;
		}

		const supportEmail = context.rp_fallback.support_email;
		if (!supportEmail) {
			return null;
		}

		return buildPrivacyRequestMailtoHref({
			attemptId: context.latest_attempt_id,
			email: supportEmail,
			organizationName: context.organization_name,
			sessionId,
		});
	}, [context, isFound, sessionId]);
	const pageDescription = isFound
		? getFoundPageDescription({
				context,
				copy: privacyCopy,
				hasOrganization,
			})
		: privacyCopy.notFoundDescription;

	const handleCancelSession = useCallback(async () => {
		if (!(isFound && cancelToken) || cancelState === "pending") {
			return;
		}

		setCancelState("pending");
		try {
			await requestCancelVerifySession(sessionId, cancelToken);
			setCancelState("succeeded");
		} catch {
			setCancelState("failed");
		}
	}, [cancelState, cancelToken, isFound, sessionId]);

	const canWithdraw =
		isFound &&
		!context.has_withdrawn_consent &&
		(!context.is_terminal ||
			context.result_webhook_deliveries.undelivered_count > 0);
	const showWithdrawAction = Boolean(cancelToken) && canWithdraw;
	const pageHeading =
		!isFound || !hasOrganization
			? privacyCopy.notFoundHeading
			: showWithdrawAction
				? privacyCopy.heading
				: context.is_terminal
					? privacyCopy.terminalHeading
					: privacyCopy.statusHeading;
	const showOrganizationRequest =
		hasOrganization && context.result_webhook_deliveries.succeeded_count > 0;
	const withdrawButtonLabel =
		cancelState === "pending"
			? privacyCopy.cancelPendingButton
			: cancelState === "succeeded"
				? privacyCopy.cancelSuccess
				: privacyCopy.cancelButton;
	const withdrawButtonClassName =
		cancelState === "succeeded"
			? "border-emerald-600/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300"
			: undefined;

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{pageHeading}
					</h1>
					<p className="text-lg text-muted-foreground">
						{renderOrganizationText({
							dim: true,
							organization,
							organizationLabel,
							template: pageDescription,
						})}
					</p>
				</div>

				<div className="my-4 space-y-4">
					{showWithdrawAction ? (
						<section className="rounded-md border border-border p-4">
							<h2 className="font-medium text-base text-foreground">
								{privacyCopy.withdrawTitle}
							</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								{context.is_terminal
									? privacyCopy.withdrawDescriptionTerminal
									: privacyCopy.withdrawDescriptionActive}
							</p>
							<div className="mt-4">
								<Button
									className={withdrawButtonClassName}
									disabled={
										cancelState === "pending" || cancelState === "succeeded"
									}
									onClick={() => {
										handleCancelSession().catch(() => {
											setCancelState("failed");
										});
									}}
									type="button"
									variant="outline"
								>
									{withdrawButtonLabel}
								</Button>
							</div>
							{cancelState === "failed" ? (
								<p className="mt-3 text-destructive text-sm">
									{privacyCopy.cancelError}
								</p>
							) : null}
						</section>
					) : null}

					{showOrganizationRequest ? (
						<section className="rounded-md border border-border p-4">
							<h2 className="font-medium text-base text-foreground">
								{renderOrganizationText({
									organization,
									organizationLabel,
									template: privacyCopy.organizationRequestTitle,
								})}
							</h2>
							<p className="mt-1 text-muted-foreground text-sm">
								{renderOrganizationText({
									dim: true,
									organization,
									organizationLabel,
									template: privacyCopy.organizationRequestDescription,
								})}
							</p>
							{rpMailtoHref ? (
								<div className="mt-4">
									<Button
										nativeButton={false}
										render={
											<a href={rpMailtoHref}>
												{interpolate(privacyCopy.rpEmailButton, {
													organization: organizationLabel,
												})}
											</a>
										}
										variant="outline"
									>
										{interpolate(privacyCopy.rpEmailButton, {
											organization: organizationLabel,
										})}
									</Button>
								</div>
							) : null}
						</section>
					) : null}

					<Button
						nativeButton={false}
						render={<a href="https://kayle.id">{privacyCopy.learnMoreLink}</a>}
						variant="outline"
					>
						{privacyCopy.learnMoreLink}
					</Button>
				</div>
			</div>
		</div>
	);
}
