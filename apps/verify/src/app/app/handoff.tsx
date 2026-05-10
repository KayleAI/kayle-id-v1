import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
import InfoCard from "@kayle-id/ui/info-card";
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
import {
	buildCancelledSessionStatus,
	readCancelTokenFromLocation,
} from "@/utils/cancel";
import { redirectToUrl } from "@/utils/navigation";
import { useDevice } from "@/utils/use-device";
import { useSession } from "../session-provider";

const REDIRECT_COUNTDOWN_SECONDS = 3;
const HANDOFF_REFRESH_INTERVAL_MS = 60_000;
const STATUS_POLL_INTERVAL_MS = 2000;

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

export function Handoff() {
	const { os } = useDevice();
	const { sessionStatus: prefetchedSessionStatus } = useSession();
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
			sessionStatus?.is_terminal ? buildTerminalContent(sessionStatus) : null,
		[sessionStatus],
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

			setHandoffError(VERIFY_HANDOFF_COPY.handoff.refreshError);
			return null;
		}
	}, [pollSessionStatus, sessionId]);

	const loadHandoffState = useCallback(async () => {
		setStatusLoading(true);

		const nextStatus = await pollSessionStatus();
		setStatusLoading(false);

		if (!nextStatus) {
			setHandoffPayload(null);
			setHandoffError(VERIFY_HANDOFF_COPY.handoff.loadStatusError);
			return;
		}

		if (!shouldShowHandoff(nextStatus)) {
			setHandoffPayload(null);
			return;
		}

		await fetchHandoffPayload();
	}, [fetchHandoffPayload, pollSessionStatus]);

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
			setHandoffError(VERIFY_HANDOFF_COPY.handoff.refreshError);
		}
	}, [handoffPayload, pollSessionStatus, sessionId]);

	const handleCancelVerification = useCallback(async () => {
		const cancelToken = readCancelTokenFromLocation();
		if (!cancelToken) {
			setIsCancelDialogOpen(false);
			setHandoffError(VERIFY_HANDOFF_COPY.handoff.cancelError);
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
			setHandoffError(VERIFY_HANDOFF_COPY.handoff.cancelError);
		} finally {
			setIsCancelInFlight(false);
		}
	}, [sessionId, sessionStatus]);

	const isTerminal = sessionStatus?.is_terminal ?? false;
	const isAwaitingCompletion = sessionStatus?.status === "in_progress";
	const isSameDeviceOnly = requiresSameDeviceOnly(sessionStatus);
	const isRetryableFailure = isRetryableFailureState(sessionStatus);
	const shouldDismissLocally = shouldCloseBrowserOnly(sessionStatus);
	const screenContent = useMemo(() => {
		if (isTerminal && terminalContent) {
			return buildTerminalScreenContent({
				redirectCountdownFallbackSeconds: REDIRECT_COUNTDOWN_SECONDS,
				redirectCountdown,
				redirectTargetUrl,
				terminalContent,
			});
		}

		if (isAwaitingCompletion) {
			return buildConnectedScreenContent();
		}

		if (isRetryableFailure) {
			return buildRetryableFailureScreenContent();
		}

		if (isSameDeviceOnly) {
			return buildSameDeviceScreenContent();
		}

		return buildInitialScreenContent({ os });
	}, [
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
				primary?: {
					label: string;
					onClick: () => void;
				};
				secondary?: {
					label: string;
					onClick: () => void;
				};
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
				label: VERIFY_HANDOFF_COPY.actions.continueNow,
				onClick: () => {
					redirectToUrl(redirectTargetUrl);
				},
			},
		};
	} else if (isTerminal) {
		buttons = {
			primary: {
				label: VERIFY_HANDOFF_COPY.actions.closeThisPage,
				onClick: () => {
					closeBrowserPage();
				},
			},
		};
	} else if (shouldDismissLocally) {
		buttons = {
			secondary: {
				label: VERIFY_HANDOFF_COPY.actions.closeThisPage,
				onClick: () => {
					closeBrowserPage();
				},
			},
		};
	} else if (handoffError) {
		buttons = {
			primary: {
				label: VERIFY_HANDOFF_COPY.actions.tryAgain,
				onClick: handleRetry,
			},
			secondary: {
				label: VERIFY_HANDOFF_COPY.actions.cancel,
				onClick: () => {
					setIsCancelDialogOpen(true);
				},
			},
		};
	} else {
		buttons = {
			secondary: {
				label: VERIFY_HANDOFF_COPY.actions.cancel,
				onClick: () => {
					setIsCancelDialogOpen(true);
				},
			},
		};
	}

	return (
		<>
			<InfoCard
				buttons={buttons}
				colour={handoffError ? "red" : screenContent.colour}
				compact={isTerminal}
				footer={false}
				header={{
					title: screenContent.headerTitle,
					description: screenContent.headerDescription,
				}}
				message={
					handoffError
						? {
								title: VERIFY_HANDOFF_COPY.handoff.errorMessageTitle,
								description:
									VERIFY_HANDOFF_COPY.handoff.errorMessageDescription,
							}
						: {
								title: screenContent.messageTitle,
								description: screenContent.messageDescription,
							}
				}
			>
				{stateContent}
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
						<AlertDialogTitle>
							{VERIFY_HANDOFF_COPY.cancelDialog.title}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{VERIFY_HANDOFF_COPY.cancelDialog.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isCancelInFlight}>
							{VERIFY_HANDOFF_COPY.cancelDialog.dismiss}
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
							{VERIFY_HANDOFF_COPY.cancelDialog.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
