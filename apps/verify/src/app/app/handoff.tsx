import { interpolate } from "@kayle-id/translations/i18n";
import { InfoCard } from "@kayle-id/ui/info-card";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayleai/ui/alert-dialog";
import { useLoaderData } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	buildConnectedScreenContent,
	buildHandoffUrl,
	buildInitialScreenContent,
	buildRetryableFailureScreenContent,
	buildSameDeviceScreenContent,
	buildTerminalContent,
	buildTerminalScreenContent,
	isHandoffPayloadExpired,
	isRetryableFailureState,
	requiresSameDeviceOnly,
	shouldCloseBrowserOnly,
	shouldShowHandoff,
} from "@/app/app/handoff-content";
import { buildPrivacyRequestPath } from "@/app/privacy-request";
import { HandoffState } from "@/components/handoff-state";
import type {
	HandoffPayload,
	VerifySessionStatusPayload,
} from "@/config/handoff";
import {
	requestCancelVerifySession,
	requestHandoffPayload,
	requestVerifyRedirectPermitted,
	requestVerifySessionStatus,
} from "@/config/handoff";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import {
	buildCancelledSessionStatus,
	readCancelTokenFromLocation,
} from "@/utils/cancel";
import { redirectToUrl } from "@/utils/navigation";
import { useDevice } from "@/utils/use-device";
import { useSession } from "../session-provider";
import type { Organization } from "./organization-name";
import { getPlatformNameLabel } from "./platform-name";

const REDIRECT_COUNTDOWN_SECONDS = 3;
const HANDOFF_REFRESH_INTERVAL_MS = 60_000;
const STATUS_POLL_INTERVAL_MS = 2000;

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

function isVerifyRequestError(
	value: unknown,
): value is Error & { code: string } {
	return (
		value instanceof Error &&
		"code" in value &&
		typeof (value as { code?: unknown }).code === "string"
	);
}

function closeBrowserPage(): void {
	if (typeof window === "undefined") {
		return;
	}

	window.close();
}

function buildMailtoHref(email: string): string {
	return `mailto:${email}`;
}

function hasRpFallbackActions(organization: Organization): boolean {
	const { rpFallback } = organization;
	return Boolean(
		rpFallback.fallbackIdvUrl ||
			rpFallback.appealUrl ||
			rpFallback.supportEmail ||
			rpFallback.complaintsUrl,
	);
}

function RpFallbackActions({ organization }: { organization: Organization }) {
	const copy = useVerifyHandoffCopy();
	const fallbackCopy = copy.rpFallback;
	const organizationLabel = getPlatformNameLabel(organization.name);
	const links: Array<{ href: string; label: string }> = [];
	const { rpFallback } = organization;

	if (rpFallback.fallbackIdvUrl) {
		links.push({
			href: rpFallback.fallbackIdvUrl,
			label: fallbackCopy.fallbackIdvLabel,
		});
	}
	if (rpFallback.appealUrl) {
		links.push({
			href: rpFallback.appealUrl,
			label: fallbackCopy.appealLabel,
		});
	}
	if (rpFallback.supportEmail) {
		links.push({
			href: buildMailtoHref(rpFallback.supportEmail),
			label: interpolate(fallbackCopy.contactLabel, {
				organization: organizationLabel,
			}),
		});
	}
	if (rpFallback.complaintsUrl) {
		links.push({
			href: rpFallback.complaintsUrl,
			label: fallbackCopy.complaintsLabel,
		});
	}

	if (links.length === 0) {
		return null;
	}

	return (
		<div className="mt-6 rounded-xl border border-border bg-muted/40 p-4">
			<p className="font-medium text-foreground text-sm">
				{fallbackCopy.title}
			</p>
			<p className="mt-1 text-muted-foreground text-sm">
				{fallbackCopy.description}
			</p>
			<div className="mt-3 flex flex-col gap-2">
				{links.map((link) => (
					<a
						className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm hover:bg-muted"
						href={link.href}
						key={`${link.label}:${link.href}`}
						rel={
							link.href.startsWith("mailto:")
								? undefined
								: "noopener noreferrer"
						}
						target={link.href.startsWith("mailto:") ? undefined : "_blank"}
					>
						{link.label}
					</a>
				))}
			</div>
		</div>
	);
}

export function Handoff() {
	const copy = useVerifyHandoffCopy();
	const { os } = useDevice();
	const { organization, sessionStatus: prefetchedSessionStatus } = useSession();
	const { sessionId } = useLoaderData({
		from: "/$",
	});
	const [handoffPayload, setHandoffPayload] = useState<HandoffPayload | null>(
		null,
	);
	const [handoffError, setHandoffError] = useState<string | null>(null);
	const [sessionStatus, setSessionStatus] =
		useState<VerifySessionStatusPayload | null>(prefetchedSessionStatus);
	const [statusLoading, setStatusLoading] = useState(
		prefetchedSessionStatus === null,
	);
	const [redirectCountdown, setRedirectCountdown] = useState<number | null>(
		null,
	);
	const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
	const [isCancelInFlight, setIsCancelInFlight] = useState(false);
	const [isRedirectPermitted, setIsRedirectPermitted] = useState<
		boolean | null
	>(null);

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

	const pollSessionStatus = useCallback(async () => {
		try {
			const nextStatus = await requestVerifySessionStatus(sessionId);

			setSessionStatus((currentStatus) =>
				currentStatus?.is_terminal ? currentStatus : nextStatus,
			);

			if (!shouldShowHandoff(nextStatus)) {
				setHandoffPayload(null);
				setHandoffError(null);
			}

			return nextStatus;
		} catch {
			// Keep polling in the background. The browser only needs the first successful terminal status.
			return null;
		}
	}, [sessionId]);

	const fetchHandoffPayload = useCallback(async () => {
		try {
			const payload = await requestHandoffPayload(sessionId);
			setHandoffPayload(payload);
			setHandoffError(null);
		} catch (error) {
			if (
				isVerifyRequestError(error) &&
				(error.code === "SESSION_IN_PROGRESS" ||
					error.code === "SESSION_EXPIRED")
			) {
				await pollSessionStatus();
				return;
			}

			setHandoffError(copy.handoff.refreshError);
			return null;
		}
	}, [copy.handoff.refreshError, pollSessionStatus, sessionId]);

	const loadHandoffState = useCallback(async () => {
		setStatusLoading(true);

		const nextStatus = await pollSessionStatus();
		setStatusLoading(false);

		if (!nextStatus) {
			setHandoffPayload(null);
			setHandoffError(copy.handoff.loadStatusError);
			return;
		}

		if (!shouldShowHandoff(nextStatus)) {
			setHandoffPayload(null);
			return;
		}

		await fetchHandoffPayload();
	}, [copy.handoff.loadStatusError, fetchHandoffPayload, pollSessionStatus]);

	const refreshHandoffPayload = useCallback(async () => {
		try {
			const payload = await requestHandoffPayload(sessionId);
			setHandoffPayload(payload);
			setHandoffError(null);
		} catch (error) {
			if (
				isVerifyRequestError(error) &&
				(error.code === "SESSION_IN_PROGRESS" ||
					error.code === "SESSION_EXPIRED")
			) {
				await pollSessionStatus();
				return;
			}

			if (
				handoffPayload &&
				!isHandoffPayloadExpired(handoffPayload, Date.now())
			) {
				return;
			}

			setHandoffPayload(null);
			setHandoffError(copy.handoff.refreshError);
		}
	}, [copy.handoff.refreshError, handoffPayload, pollSessionStatus, sessionId]);

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
			setStatusLoading(false);
			setSessionStatus(
				buildCancelledSessionStatus({
					sessionId,
					sessionStatus,
				}),
			);
		} catch {
			setIsCancelDialogOpen(false);
			setHandoffError(copy.handoff.cancelError);
		} finally {
			setIsCancelInFlight(false);
		}
	}, [copy.handoff.cancelError, sessionId, sessionStatus]);

	const isTerminal = sessionStatus?.is_terminal ?? false;
	const isAwaitingCompletion = sessionStatus?.status === "in_progress";
	const isSameDeviceOnly = requiresSameDeviceOnly(sessionStatus);
	const isRetryableFailure = isRetryableFailureState(sessionStatus);
	const shouldDismissLocally = shouldCloseBrowserOnly(sessionStatus);
	const shouldShowRpFallback =
		!handoffError &&
		hasRpFallbackActions(organization) &&
		(isRetryableFailure || (isTerminal && terminalContent?.colour === "red"));
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

	useEffect(() => {
		if (isTerminal) {
			return;
		}

		const intervalId = window.setInterval(() => {
			pollSessionStatus().catch(() => {
				/* pollSessionStatus already handles its own errors */
			});
		}, STATUS_POLL_INTERVAL_MS);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [isTerminal, pollSessionStatus]);

	useEffect(() => {
		if (!prefetchedSessionStatus) {
			loadHandoffState().catch(() => {
				// loadHandoffState already stores the error state that the UI renders.
			});
			return;
		}

		setSessionStatus(prefetchedSessionStatus);
		setStatusLoading(false);

		if (!shouldShowHandoff(prefetchedSessionStatus)) {
			return;
		}

		fetchHandoffPayload().catch(() => {
			// fetchHandoffPayload already stores the error state that the UI renders.
		});
	}, [fetchHandoffPayload, loadHandoffState, prefetchedSessionStatus]);

	useEffect(() => {
		if (isTerminal || !shouldShowHandoff(sessionStatus)) {
			return;
		}

		const intervalId = window.setInterval(() => {
			refreshHandoffPayload().catch(() => {
				// refreshHandoffPayload already updates the handoff state or syncs terminal status.
			});
		}, HANDOFF_REFRESH_INTERVAL_MS);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [isTerminal, refreshHandoffPayload, sessionStatus]);

	useEffect(() => {
		if (!(sessionStatus?.is_terminal && sessionStatus.redirect_url)) {
			setIsRedirectPermitted(null);
			return;
		}

		let cancelled = false;
		requestVerifyRedirectPermitted(sessionStatus.session_id)
			.then((result) => {
				if (cancelled) {
					return;
				}
				setIsRedirectPermitted(result.permitted);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setIsRedirectPermitted(false);
			});

		return () => {
			cancelled = true;
		};
	}, [sessionStatus]);

	useEffect(() => {
		if (!redirectTargetUrl) {
			setRedirectCountdown(null);
			return;
		}

		setRedirectCountdown(REDIRECT_COUNTDOWN_SECONDS);

		const countdownIntervalId = window.setInterval(() => {
			setRedirectCountdown((currentCountdown) => {
				if (currentCountdown === null) {
					return REDIRECT_COUNTDOWN_SECONDS;
				}

				return Math.max(0, currentCountdown - 1);
			});
		}, 1000);

		const redirectTimeoutId = window.setTimeout(() => {
			redirectToUrl(redirectTargetUrl);
		}, REDIRECT_COUNTDOWN_SECONDS * 1000);

		return () => {
			window.clearInterval(countdownIntervalId);
			window.clearTimeout(redirectTimeoutId);
		};
	}, [redirectTargetUrl]);

	let stateContent: ReactNode = null;
	let buttons:
		| {
				primary?: HandoffButtonAction;
				secondary?: HandoffButtonAction;
		  }
		| undefined;

	const handleRetry = () => {
		loadHandoffState().catch(() => {
			// loadHandoffState already stores the error state that the UI renders.
		});
	};

	if (statusLoading || shouldShowHandoff(sessionStatus) || handoffError) {
		stateContent = (
			<HandoffState
				handoffError={handoffError}
				handoffUrl={handoffUrl}
				onRetry={handleRetry}
				os={os}
			/>
		);
	}

	if (redirectTargetUrl) {
		buttons = {
			primary: {
				label: copy.actions.continueNow,
				onClick: () => {
					redirectToUrl(redirectTargetUrl);
				},
			},
			secondary: {
				href: privacyRequestPath,
				label: copy.privacyRequest.linkLabel,
			},
		};
	} else if (isTerminal) {
		buttons = {
			primary: {
				label: copy.actions.closeThisPage,
				onClick: () => {
					closeBrowserPage();
				},
			},
			secondary: {
				href: privacyRequestPath,
				label: copy.privacyRequest.linkLabel,
			},
		};
	} else if (shouldDismissLocally) {
		buttons = {
			secondary: {
				label: copy.actions.closeThisPage,
				onClick: () => {
					closeBrowserPage();
				},
			},
		};
	} else if (handoffError) {
		buttons = {
			primary: {
				label: copy.actions.tryAgain,
				onClick: handleRetry,
			},
			secondary: {
				label: copy.actions.cancelOrWithdrawConsent,
				onClick: () => {
					setIsCancelDialogOpen(true);
				},
			},
		};
	} else {
		buttons = {
			secondary: {
				label: copy.actions.cancelOrWithdrawConsent,
				onClick: () => {
					setIsCancelDialogOpen(true);
				},
			},
		};
	}

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
			<AlertDialog
				onOpenChange={(open) => {
					if (isCancelInFlight) {
						return;
					}
					setIsCancelDialogOpen(open);
				}}
				open={isCancelDialogOpen}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{copy.cancelDialog.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{copy.cancelDialog.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isCancelInFlight}>
							{copy.cancelDialog.dismiss}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={isCancelInFlight}
							onClick={() => {
								handleCancelVerification().catch(() => {
									// handleCancelVerification already stores the error state that the UI renders.
								});
							}}
							variant="destructive"
						>
							{copy.cancelDialog.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
