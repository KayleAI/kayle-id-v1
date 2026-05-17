import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayleai/ui/button";
import { Logo } from "@kayleai/ui/logo";
import { useLoaderData } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	requestCancelVerifySession,
	requestVerifySessionDetails,
	requestVerifySessionStatus,
	type VerifySessionDetailsPayload,
	type VerifySessionStatusPayload,
} from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { readCancelTokenFromLocation } from "@/utils/cancel";
import { getPlatformNameLabel } from "./app/platform-name";

const KAYLE_PRIVACY_EMAIL = "help@kayle.id";

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
	const path = `/privacy/${encodeURIComponent(sessionId)}`;
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
		"I am making a privacy request for this Kayle ID check.",
		"",
		"Request type: withdrawal, deletion, or data access",
		`Session ID: ${sessionId}`,
		`Latest attempt ID: ${attemptId ?? "not available"}`,
		`Organization: ${organizationName ?? "not available"}`,
		"",
		"I do not have a Kayle account for this check.",
		"",
		"Request details:",
	];
	const subject = `Kayle ID privacy request for ${sessionId}`;
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

function isLoadingPrivacyContext({
	details,
	isLoading,
	status,
}: {
	details: VerifySessionDetailsPayload | null;
	isLoading: boolean;
	status: VerifySessionStatusPayload | null;
}): boolean {
	return isLoading && !(details || status);
}

export function PrivacyRequestPage() {
	const { sessionId } = useLoaderData({ from: "/privacy/$sessionId" });
	const copy = useVerifyHandoffCopy();
	const privacyCopy = copy.privacyRequest;
	const [details, setDetails] = useState<VerifySessionDetailsPayload | null>(
		null,
	);
	const [status, setStatus] = useState<VerifySessionStatusPayload | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [cancelState, setCancelState] = useState<
		"idle" | "pending" | "succeeded" | "failed"
	>("idle");
	const cancelToken = useMemo(readCancelTokenFromLocation, []);

	useEffect(() => {
		let isStale = false;
		setIsLoading(true);
		setLoadError(null);

		Promise.allSettled([
			requestVerifySessionDetails(sessionId),
			requestVerifySessionStatus(sessionId),
		]).then(([detailsResult, statusResult]) => {
			if (isStale) {
				return;
			}

			if (detailsResult.status === "fulfilled") {
				setDetails(detailsResult.value);
			}
			if (statusResult.status === "fulfilled") {
				setStatus(statusResult.value);
			}
			if (
				detailsResult.status === "rejected" &&
				statusResult.status === "rejected"
			) {
				setLoadError(privacyCopy.loadError);
			}
			setIsLoading(false);
		});

		return () => {
			isStale = true;
		};
	}, [privacyCopy.loadError, sessionId]);

	const attemptId = status?.latest_attempt?.id ?? null;
	const organizationName = details?.organization_name ?? null;
	const organizationLabel = getPlatformNameLabel(organizationName);
	const kayleMailtoHref = useMemo(
		() =>
			buildPrivacyRequestMailtoHref({
				attemptId,
				email: KAYLE_PRIVACY_EMAIL,
				organizationName,
				sessionId,
			}),
		[attemptId, organizationName, sessionId],
	);
	const rpMailtoHref = useMemo(() => {
		const supportEmail = details?.rp_fallback.support_email;
		if (!supportEmail) {
			return null;
		}

		return buildPrivacyRequestMailtoHref({
			attemptId,
			email: supportEmail,
			organizationName,
			sessionId,
		});
	}, [
		attemptId,
		details?.rp_fallback.support_email,
		organizationName,
		sessionId,
	]);

	const handleCancelSession = useCallback(async () => {
		if (!cancelToken || cancelState === "pending") {
			return;
		}

		setCancelState("pending");
		try {
			await requestCancelVerifySession(sessionId, cancelToken);
			setCancelState("succeeded");
		} catch {
			setCancelState("failed");
		}
	}, [cancelState, cancelToken, sessionId]);

	const isLoadingContext = isLoadingPrivacyContext({
		details,
		isLoading,
		status,
	});

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="flex w-full max-w-md flex-col">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						{privacyCopy.heading}
					</h1>
					<p className="text-lg text-muted-foreground">
						{privacyCopy.description}
					</p>
				</div>

				<div className="my-8 space-y-5">
					<section className="rounded-md border border-border p-4">
						<h2 className="font-medium text-base text-foreground">
							{privacyCopy.scopeTitle}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{privacyCopy.scopeDescription}
						</p>
						<dl className="mt-4 space-y-3 text-sm">
							<div>
								<dt className="font-medium text-foreground">
									{privacyCopy.sessionIdLabel}
								</dt>
								<dd className="break-all text-muted-foreground">{sessionId}</dd>
							</div>
							<div>
								<dt className="font-medium text-foreground">
									{privacyCopy.attemptIdLabel}
								</dt>
								<dd className="break-all text-muted-foreground">
									{attemptId ?? privacyCopy.attemptUnavailable}
								</dd>
							</div>
							<div>
								<dt className="font-medium text-foreground">
									{privacyCopy.organizationLabel}
								</dt>
								<dd className="text-muted-foreground">{organizationLabel}</dd>
							</div>
						</dl>
					</section>

					<section className="rounded-md border border-border p-4">
						<h2 className="font-medium text-base text-foreground">
							{privacyCopy.withdrawTitle}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{cancelToken
								? privacyCopy.withdrawDescriptionWithToken
								: privacyCopy.withdrawDescriptionWithoutToken}
						</p>
						<div className="mt-4">
							<Button
								disabled={!cancelToken || cancelState === "pending"}
								onClick={() => {
									handleCancelSession().catch(() => {
										setCancelState("failed");
									});
								}}
								type="button"
								variant="outline"
							>
								{cancelState === "pending"
									? privacyCopy.cancelPendingButton
									: privacyCopy.cancelButton}
							</Button>
						</div>
						{cancelState === "succeeded" ? (
							<p className="mt-3 text-emerald-700 text-sm dark:text-emerald-300">
								{privacyCopy.cancelSuccess}
							</p>
						) : null}
						{cancelState === "failed" ? (
							<p className="mt-3 text-destructive text-sm">
								{privacyCopy.cancelError}
							</p>
						) : null}
					</section>

					<section className="rounded-md border border-border p-4">
						<h2 className="font-medium text-base text-foreground">
							{privacyCopy.requestTitle}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{privacyCopy.requestDescription}
						</p>
						<div className="mt-4 flex flex-col gap-3">
							<Button
								nativeButton={false}
								render={
									<a href={kayleMailtoHref}>{privacyCopy.kayleEmailButton}</a>
								}
							>
								{privacyCopy.kayleEmailButton}
							</Button>
							{rpMailtoHref ? (
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
							) : null}
						</div>
					</section>

					{isLoadingContext ? (
						<p className="text-muted-foreground text-sm">
							{privacyCopy.loading}
						</p>
					) : null}
					{loadError ? (
						<p className="text-destructive text-sm" role="alert">
							{loadError}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
}
