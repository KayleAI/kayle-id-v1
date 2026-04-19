import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
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
import InfoCard from "@/components/info";
import { HandoffState } from "@/components/handoff-state";
import type {
  HandoffPayload,
  VerifySessionStatusPayload,
} from "@/config/handoff";
import {
  requestCancelVerifySession,
  requestHandoffPayload,
  requestVerifySessionStatus,
} from "@/config/handoff";
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
  value: unknown
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

function buildCancelledSessionStatus({
  sessionId,
  sessionStatus,
}: {
  sessionId: string;
  sessionStatus: VerifySessionStatusPayload | null;
}): VerifySessionStatusPayload {
  return {
    completed_at: new Date().toISOString(),
    is_terminal: true,
    latest_attempt: sessionStatus?.latest_attempt
      ? {
          ...sessionStatus.latest_attempt,
          retry_allowed: false,
        }
      : null,
    redirect_url: null,
    session_id: sessionId,
    same_device_only: sessionStatus?.same_device_only ?? false,
    status: "cancelled",
  };
}

export function Handoff() {
  const { os } = useDevice();
  const { sessionStatus: prefetchedSessionStatus } = useSession();
  const { sessionId } = useLoaderData({
    from: "/$",
  });
  const [handoffPayload, setHandoffPayload] = useState<HandoffPayload | null>(
    null
  );
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<VerifySessionStatusPayload | null>(prefetchedSessionStatus);
  const [statusLoading, setStatusLoading] = useState(
    prefetchedSessionStatus === null
  );
  const [redirectCountdown, setRedirectCountdown] = useState<number | null>(
    null
  );

  const handoffUrl = useMemo(
    () => (handoffPayload ? buildHandoffUrl(handoffPayload) : null),
    [handoffPayload]
  );

  const redirectTargetUrl = useMemo(() => {
    if (!(sessionStatus?.is_terminal && sessionStatus.redirect_url)) {
      return null;
    }

    return buildRedirectTargetUrl({
      redirectUrl: sessionStatus.redirect_url,
      sessionId: sessionStatus.session_id,
    });
  }, [sessionStatus]);

  const terminalContent = useMemo(
    () =>
      sessionStatus?.is_terminal ? buildTerminalContent(sessionStatus) : null,
    [sessionStatus]
  );

  const pollSessionStatus = useCallback(async () => {
    try {
      const nextStatus = await requestVerifySessionStatus(sessionId);

      setSessionStatus((currentStatus) =>
        currentStatus?.is_terminal ? currentStatus : nextStatus
      );

      if (!shouldShowHandoff(nextStatus)) {
        setHandoffPayload(null);
        setHandoffError(null);
        setHandoffLoading(false);
      }

      return nextStatus;
    } catch {
      // Keep polling in the background. The browser only needs the first successful terminal status.
      return null;
    }
  }, [sessionId]);

  const fetchHandoffPayload = useCallback(async () => {
    setHandoffLoading(true);
    setHandoffError(null);
    setHandoffPayload(null);

    try {
      const payload = await requestHandoffPayload(sessionId);
      setHandoffPayload(payload);
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
    } finally {
      setHandoffLoading(false);
    }
  }, [pollSessionStatus, sessionId]);

  const loadHandoffState = useCallback(async () => {
    setStatusLoading(true);
    setHandoffError(null);

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
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(VERIFY_HANDOFF_COPY.actions.cancelConfirmation)
    ) {
      return;
    }

    try {
      await requestCancelVerifySession(sessionId);
      setHandoffPayload(null);
      setHandoffError(null);
      setHandoffLoading(false);
      setStatusLoading(false);
      setSessionStatus(
        buildCancelledSessionStatus({
          sessionId,
          sessionStatus,
        })
      );
    } catch {
      setHandoffError(VERIFY_HANDOFF_COPY.handoff.cancelError);
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

  if (statusLoading || shouldShowHandoff(sessionStatus) || handoffError) {
    stateContent = (
      <HandoffState
        handoffError={handoffError}
        handoffLoading={handoffLoading || statusLoading}
        handoffUrl={handoffUrl}
        onRetry={loadHandoffState}
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
  } else {
    buttons = {
      secondary: {
        label: VERIFY_HANDOFF_COPY.actions.cancel,
        onClick: () => {
          handleCancelVerification().catch(() => {
            // handleCancelVerification already stores the error state that the UI renders.
          });
        },
      },
    };
  }

  return (
    <InfoCard
      buttons={buttons}
      colour={screenContent.colour}
      footer={false}
      header={{
        title: screenContent.headerTitle,
        description: screenContent.headerDescription,
      }}
      message={{
        title: screenContent.messageTitle,
        description: screenContent.messageDescription,
      }}
    >
      {stateContent}
    </InfoCard>
  );
}
