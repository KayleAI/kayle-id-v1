import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayle-id/ui/components/button";
import { Logo } from "@kayle-id/ui/components/logo";
import { useMemo, useState } from "react";
import { useCancelSession } from "@/hooks/use-cancel-session";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { OrganizationName } from "@/screens/organization/name";
import { getPlatformNameLabel } from "@/screens/organization/platform-name";
import { OrganizationReportAction } from "@/screens/organization/report-dialog";
import {
	buildPrivacyRequestMailtoHref,
	getFoundPageDescription,
	getPrivacyOrganization,
	renderOrganizationText,
} from "./helpers";
import type { PrivacyRequestRouteContext } from "./types";

export {
	buildPrivacyRequestMailtoHref,
	buildPrivacyRequestPath,
} from "./helpers";
export type { PrivacyRequestRouteContext } from "./types";

const WITHDRAW_SUCCESS_BUTTON_CLASSES =
	"border-emerald-600/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300";

const renderOrgNode = ({
	dim,
	organization,
}: {
	dim: boolean;
	organization: ReturnType<typeof getPrivacyOrganization>;
}) =>
	organization ? (
		<OrganizationName dim={dim} organization={organization} />
	) : null;

export function PrivacyRequestPage({
	cancelToken,
	context,
}: {
	cancelToken: string | null;
	context: PrivacyRequestRouteContext;
}) {
	const copy = useVerifyHandoffCopy();
	const privacyCopy = copy.privacyRequest;
	const sessionId = context.session_id;
	const cancelSession = useCancelSession(sessionId);
	const [submittedAttempt, setSubmittedAttempt] = useState(false);

	const isFound = context.kind === "found";
	const hasOrganization = isFound && context.organization_name !== null;
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
			email: supportEmail,
			organizationName: context.organization_name,
			sessionId,
		});
	}, [context, isFound, sessionId]);

	const pageDescription = isFound
		? getFoundPageDescription({ context, copy: privacyCopy, hasOrganization })
		: privacyCopy.notFoundDescription;

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
		cancelSession.state === "pending"
			? privacyCopy.cancelPendingButton
			: cancelSession.state === "succeeded"
				? privacyCopy.cancelSuccess
				: privacyCopy.cancelButton;

	const handleWithdraw = () => {
		setSubmittedAttempt(true);
		cancelSession.cancel(cancelToken).catch(() => {
			/* state already reflects the failure */
		});
	};

	const renderTemplate = (
		template: string,
		{ dim = false }: { dim?: boolean } = {},
	) =>
		renderOrganizationText({
			dim,
			organization,
			organizationLabel,
			template,
			renderOrganization: renderOrgNode,
		});

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
					<div className="text-lg text-muted-foreground">
						{renderTemplate(pageDescription, { dim: true })}
					</div>
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
									className={
										cancelSession.state === "succeeded"
											? WITHDRAW_SUCCESS_BUTTON_CLASSES
											: undefined
									}
									disabled={
										cancelSession.state === "pending" ||
										cancelSession.state === "succeeded"
									}
									onClick={handleWithdraw}
									type="button"
									variant="outline"
								>
									{withdrawButtonLabel}
								</Button>
							</div>
							{submittedAttempt && cancelSession.state === "failed" ? (
								<p className="mt-3 text-destructive text-sm">
									{privacyCopy.cancelError}
								</p>
							) : null}
						</section>
					) : null}

					{showOrganizationRequest ? (
						<section className="rounded-md border border-border p-4">
							<h2 className="font-medium text-base text-foreground">
								{renderTemplate(privacyCopy.organizationRequestTitle)}
							</h2>
							<div className="mt-1 text-muted-foreground text-sm">
								{renderTemplate(privacyCopy.organizationRequestDescription, {
									dim: true,
								})}
							</div>
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

					<div className="flex flex-wrap items-center gap-2">
						<Button
							nativeButton={false}
							render={
								<a href="https://kayle.id">{privacyCopy.learnMoreLink}</a>
							}
							variant="outline"
						>
							{privacyCopy.learnMoreLink}
						</Button>
						{organization ? (
							<OrganizationReportAction
								organization={organization}
								sessionId={sessionId}
							/>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}
