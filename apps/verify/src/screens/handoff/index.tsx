import { InfoCard } from "@kayle-id/ui/info-card";
import { useLoaderData } from "@tanstack/react-router";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { requestCancelVerifySession } from "@/api/verify-api";
import { useSession } from "@/app/session-provider";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { HandoffState } from "@/components/handoff-state";
import { useDevice } from "@/hooks/use-device";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { buildPrivacyRequestPath } from "@/screens/privacy-request";
import {
	buildCancelledSessionStatus,
	readCancelTokenFromLocation,
} from "@/utils/cancel";
import { redirectToUrl } from "@/utils/navigation";
import { hasRpFallbackActions, RpFallbackActions } from "./rp-fallback-actions";
import {
	buildConnectedScreenContent,
	buildHandoffUrl,
	buildInitialScreenContent,
	buildRetryableFailureScreenContent,
	buildSameDeviceScreenContent,
	buildTerminalContent,
	buildTerminalScreenContent,
	isRetryableFailureState,
	requiresSameDeviceOnly,
	shouldCloseBrowserOnly,
	shouldShowHandoff,
} from "./screen-content";
import { useHandoffSession } from "./use-handoff-session";
import { useRedirectCountdown } from "./use-redirect-countdown";

const REDIRECT_COUNTDOWN_SECONDS = 3;

type HandoffButtonAction = {
	label: string;
} & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

function buildRedirectTargetUrl({
	redirectUrl,
	sessionId,
}: {
	redirectUrl: string;
	sessionId: string;
}): string {
	const targetUrl = new URL(redirectUrl, window.location.href);
	targetUrl.searchParams.set("session_id", sessionId);
	return targetUrl.toString();
}

function closeBrowserPage(): void {
	if (typeof window !== "undefined") {
		window.close();
	}
}

export function Handoff() {
	const copy = useVerifyHandoffCopy();
	const { os } = useDevice();
	const { organization, sessionStatus: prefetchedSessionStatus } = useSession();
	const { sessionId } = useLoaderData({ from: "/$" });
	const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
	const [isCancelInFlight, setIsCancelInFlight] = useState(false);

	const session = useHandoffSession({ sessionId, prefetchedSessionStatus });
	const {
		handoffPayload,
		handoffError,
		sessionStatus,
		statusLoading,
		isRedirectPermitted,
		reload,
		setHandoffError,
		setHandoffPayload,
		setSessionStatus,
	} = session;

	const cancelTokenFromLocation = useMemo(readCancelTokenFromLocation, []);

	const handoffUrl = useMemo(
		() =>
			handoffPayload
				? buildHandoffUrl(handoffPayload, cancelTokenFromLocation ?? undefined)
				: null,
		[handoffPayload, cancelTokenFromLocation],
	);

	const privacyRequestPath = useMemo(
		() =>
			buildPrivacyRequestPath({
				cancelToken: cancelTokenFromLocation,
				sessionId,
			}),
		[cancelTokenFromLocation, sessionId],
	);

	const redirectTargetUrl = useMemo(() => {
		if (!(sessionStatus?.is_terminal && sessionStatus.redirect_url)) {
			return null;
		}
		if (isRedirectPermitted === false) {
			return null;
		}
		return buildRedirectTargetUrl({
			redirectUrl: sessionStatus.redirect_url,
			sessionId: sessionStatus.session_id,
		});
	}, [sessionStatus, isRedirectPermitted]);

	const terminalContent = useMemo(
		() =>
			sessionStatus?.is_terminal
				? buildTerminalContent(sessionStatus, copy)
				: null,
		[sessionStatus, copy],
	);

	const isTerminal = sessionStatus?.is_terminal ?? false;
	const isAwaitingCompletion = sessionStatus?.status === "in_progress";
	const isSameDeviceOnly = requiresSameDeviceOnly(sessionStatus);
	const isRetryableFailure = isRetryableFailureState(sessionStatus);
	const shouldDismissLocally = shouldCloseBrowserOnly(sessionStatus);
	const shouldShowRpFallback =
		!handoffError &&
		hasRpFallbackActions(organization) &&
		(isRetryableFailure || (isTerminal && terminalContent?.colour === "red"));

	const redirectCountdown = useRedirectCountdown({
		targetUrl: redirectTargetUrl,
		seconds: REDIRECT_COUNTDOWN_SECONDS,
	});

	const screenContent = useMemo(() => {
		if (isTerminal && terminalContent) {
			return buildTerminalScreenContent({
				copy,
				redirectCountdownFallbackSeconds: REDIRECT_COUNTDOWN_SECONDS,
				redirectCountdown,
				redirectTargetUrl,
				terminalContent,
			});
		}
		if (isAwaitingCompletion) {
			return buildConnectedScreenContent(copy);
		}
		if (isRetryableFailure) {
			return buildRetryableFailureScreenContent(copy);
		}
		if (isSameDeviceOnly) {
			return buildSameDeviceScreenContent(copy);
		}
		return buildInitialScreenContent({ os, copy });
	}, [
		copy,
		isAwaitingCompletion,
		isRetryableFailure,
		isSameDeviceOnly,
		isTerminal,
		os,
		redirectCountdown,
		redirectTargetUrl,
		terminalContent,
	]);

	const handleRetry = useCallback(() => {
		reload().catch(() => {});
	}, [reload]);

	const handleCancelVerification = useCallback(async () => {
		const cancelToken = readCancelTokenFromLocation();
		if (!cancelToken) {
			setIsCancelDialogOpen(false);
			setHandoffError(copy.handoff.cancelError);
			return;
		}

		setIsCancelInFlight(true);
		try {
			await requestCancelVerifySession(sessionId, cancelToken);
			setIsCancelDialogOpen(false);
			setHandoffPayload(null);
			setHandoffError(null);
			setSessionStatus(
				buildCancelledSessionStatus({ sessionId, sessionStatus }),
			);
		} catch {
			setIsCancelDialogOpen(false);
			setHandoffError(copy.handoff.cancelError);
		} finally {
			setIsCancelInFlight(false);
		}
	}, [
		copy.handoff.cancelError,
		sessionId,
		sessionStatus,
		setHandoffError,
		setHandoffPayload,
		setSessionStatus,
	]);

	const stateContent: ReactNode | null =
		statusLoading || shouldShowHandoff(sessionStatus) || handoffError ? (
			<HandoffState
				handoffError={handoffError}
				handoffUrl={handoffUrl}
				onRetry={handleRetry}
				os={os}
			/>
		) : null;

	const buttons = computeButtons({
		copy,
		handoffError: Boolean(handoffError),
		isTerminal,
		onCancel: () => setIsCancelDialogOpen(true),
		onRedirect: () => {
			if (redirectTargetUrl) {
				redirectToUrl(redirectTargetUrl);
			}
		},
		onRetry: handleRetry,
		privacyRequestPath,
		redirectTargetUrl,
		shouldDismissLocally,
	});

	const infoCardChildren =
		stateContent !== null || shouldShowRpFallback ? (
			<>
				{stateContent}
				{shouldShowRpFallback ? (
					<RpFallbackActions organization={organization} />
				) : null}
			</>
		) : undefined;

	return (
		<>
			<InfoCard
				buttons={buttons}
				colour={handoffError ? "red" : screenContent.colour}
				footer={false}
				header={{
					title: screenContent.headerTitle,
					description: screenContent.headerDescription,
				}}
				message={
					handoffError
						? {
								title: copy.handoff.errorMessageTitle,
								description: copy.handoff.errorMessageDescription,
							}
						: {
								title: screenContent.messageTitle,
								description: screenContent.messageDescription,
							}
				}
			>
				{infoCardChildren}
			</InfoCard>
			<ConfirmDialog
				confirmLabel={copy.cancelDialog.confirm}
				description={copy.cancelDialog.description}
				dismissLabel={copy.cancelDialog.dismiss}
				inFlight={isCancelInFlight}
				onConfirm={() => {
					handleCancelVerification().catch(() => {});
				}}
				onOpenChange={setIsCancelDialogOpen}
				open={isCancelDialogOpen}
				testId="cancel-dialog"
				title={copy.cancelDialog.title}
			/>
		</>
	);
}

type HandoffCopy = ReturnType<typeof useVerifyHandoffCopy>;

function computeButtons({
	copy,
	handoffError,
	isTerminal,
	onCancel,
	onRedirect,
	onRetry,
	privacyRequestPath,
	redirectTargetUrl,
	shouldDismissLocally,
}: {
	copy: HandoffCopy;
	handoffError: boolean;
	isTerminal: boolean;
	onCancel: () => void;
	onRedirect: () => void;
	onRetry: () => void;
	privacyRequestPath: string;
	redirectTargetUrl: string | null;
	shouldDismissLocally: boolean;
}):
	| { primary?: HandoffButtonAction; secondary?: HandoffButtonAction }
	| undefined {
	if (redirectTargetUrl) {
		return {
			primary: { label: copy.actions.continueNow, onClick: onRedirect },
			secondary: {
				href: privacyRequestPath,
				label: copy.privacyRequest.linkLabel,
			},
		};
	}
	if (isTerminal) {
		return {
			primary: { label: copy.actions.closeThisPage, onClick: closeBrowserPage },
			secondary: {
				href: privacyRequestPath,
				label: copy.privacyRequest.linkLabel,
			},
		};
	}
	if (shouldDismissLocally) {
		return {
			secondary: {
				label: copy.actions.closeThisPage,
				onClick: closeBrowserPage,
			},
		};
	}
	if (handoffError) {
		return {
			primary: { label: copy.actions.tryAgain, onClick: onRetry },
			secondary: {
				label: copy.actions.cancelOrWithdrawConsent,
				onClick: onCancel,
			},
		};
	}
	return {
		secondary: {
			label: copy.actions.cancelOrWithdrawConsent,
			onClick: onCancel,
		},
	};
}
