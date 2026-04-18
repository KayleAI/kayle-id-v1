import { Button } from "@kayleai/ui/button";
import { useLoaderData } from "@tanstack/react-router";
import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import InfoCard from "@/components/info";
import type {
  HandoffPayload,
  VerifySessionStatusPayload,
} from "@/config/handoff";
import {
  requestCancelVerifySession,
  requestHandoffPayload,
  requestVerifySessionStatus,
} from "@/config/handoff";
import OctagonWarning from "@/icons/octagon-warning";
import Spinner from "@/icons/spinner";
import { redirectToUrl } from "@/utils/navigation";
import { useDevice } from "@/utils/use-device";

const REDIRECT_COUNTDOWN_SECONDS = 3;
const HANDOFF_REFRESH_INTERVAL_MS = 60_000;
const STATUS_POLL_INTERVAL_MS = 2000;

type CardTone = "blue" | "emerald" | "red";

type ScreenContent = {
  colour: CardTone;
  headerDescription: string;
  headerTitle: string;
  messageDescription: string;
  messageTitle: string;
};

type TerminalContent = {
  colour: CardTone;
  description: string;
  title: string;
};

type HandoffStateContentProps = {
  fetchHandoffPayload: () => void | Promise<void>;
  handoffError: string | null;
  handoffLoading: boolean;
  handoffUrl: string | null;
  os: string | null;
};

function buildHandoffUrl(payload: HandoffPayload): string {
  return `kayle-id://${encodeURIComponent(JSON.stringify(payload))}`;
}

function isHandoffPayloadExpired(
  payload: HandoffPayload,
  nowMs: number
): boolean {
  return new Date(payload.expires_at).getTime() <= nowMs;
}

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

function buildTerminalContent(
  sessionStatus: VerifySessionStatusPayload
): TerminalContent {
  if (sessionStatus.status === "cancelled") {
    return {
      colour: "red",
      description: "This verification was cancelled before it could finish.",
      title: "Verification cancelled",
    };
  }

  if (sessionStatus.status === "expired") {
    return {
      colour: "red",
      description: "This verification session expired before it could finish.",
      title: "Verification expired",
    };
  }

  const failureCode = sessionStatus.latest_attempt?.failure_code;

  if (failureCode === "passport_authenticity_failed") {
    return {
      colour: "red",
      description:
        "The document integrity checks did not pass for the latest attempt.",
      title: "Verification failed",
    };
  }

  if (failureCode === "selfie_face_mismatch") {
    return {
      colour: "red",
      description:
        "The selfie evidence did not match the passport photo on the latest attempt.",
      title: "Verification failed",
    };
  }

  if (sessionStatus.latest_attempt?.status === "failed") {
    return {
      colour: "red",
      description: "The latest verification attempt did not pass.",
      title: "Verification failed",
    };
  }

  return {
    colour: "emerald",
    description:
      "The verification finished successfully on your mobile device.",
    title: "Verification complete",
  };
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

function buildInitialScreenContent({
  os,
}: {
  os: string | null;
}): ScreenContent {
  return {
    colour: "blue",
    headerDescription:
      "This verification continues in the Kayle ID mobile app.",
    headerTitle: "Open Kayle ID on your phone",
    messageDescription:
      os === "ios"
        ? "Open the app directly on this device to continue your verification session."
        : "Scan the QR code with the phone you want to use for verification.",
    messageTitle: "Use your mobile device to continue",
  };
}

function buildConnectedScreenContent(): ScreenContent {
  return {
    colour: "blue",
    headerDescription:
      "Your mobile device is now connected to this verification session.",
    headerTitle: "Continue on your device",
    messageDescription:
      "Finish the remaining steps in the Kayle ID app. This page will update automatically when the session concludes.",
    messageTitle: "Verification is in progress",
  };
}

function buildRetryableFailureScreenContent(): ScreenContent {
  return {
    colour: "red",
    headerDescription:
      "This verification must stay on the mobile device that already started it.",
    headerTitle: "Retry on the same device",
    messageDescription:
      "The latest attempt did not pass. Retry or cancel in the Kayle ID app on that same device to continue.",
    messageTitle: "QR handoff is unavailable",
  };
}

function buildSameDeviceScreenContent(): ScreenContent {
  return {
    colour: "blue",
    headerDescription:
      "This verification is reserved for the mobile device that already claimed it.",
    headerTitle: "Continue on your device",
    messageDescription:
      "Open Kayle ID on that same device to continue. A new QR handoff is no longer available for this session.",
    messageTitle: "Waiting for your device",
  };
}

function buildTerminalScreenContent({
  redirectCountdown,
  redirectTargetUrl,
  terminalContent,
}: {
  redirectCountdown: number | null;
  redirectTargetUrl: string | null;
  terminalContent: TerminalContent;
}): ScreenContent {
  return {
    colour: terminalContent.colour,
    headerDescription: redirectTargetUrl
      ? "You can continue now or wait for the automatic redirect."
      : "This verification session has finished.",
    headerTitle: terminalContent.title,
    messageDescription: redirectTargetUrl
      ? `${terminalContent.description} Redirecting in ${
          redirectCountdown ?? REDIRECT_COUNTDOWN_SECONDS
        } seconds.`
      : `${terminalContent.description} You can now close this page.`,
    messageTitle:
      terminalContent.colour === "emerald"
        ? "Finished on your mobile device"
        : "Verification outcome",
  };
}

function HandoffStateContent({
  fetchHandoffPayload,
  handoffError,
  handoffLoading,
  handoffUrl,
  os,
}: HandoffStateContentProps) {
  if (handoffLoading) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>Preparing a secure handoff for your mobile device.</p>
      </div>
    );
  }

  if (handoffError) {
    return (
      <div className="space-y-4 pt-2 text-sm">
        <div className="flex items-center gap-3 text-red-700">
          <OctagonWarning className="size-5 shrink-0" />
          <p>{handoffError}</p>
        </div>
        <Button className="w-full" onClick={fetchHandoffPayload} type="button">
          Try again
        </Button>
      </div>
    );
  }

  if (!handoffUrl) {
    return (
      <div className="flex items-center gap-3 pt-2 text-muted-foreground text-sm">
        <Spinner className="size-5" />
        <p>Waiting for your secure handoff details.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-2">
      {os === "ios" ? (
        <Button
          className="w-full"
          nativeButton={false}
          render={<a href={handoffUrl}>Open Kayle ID app</a>}
        >
          Open Kayle ID app
        </Button>
      ) : null}
      <div className="flex justify-center rounded-lg border border-blue-200 border-dashed bg-white p-4">
        <QRCodeSVG
          bgColor="transparent"
          fgColor="currentColor"
          level="M"
          size={200}
          value={handoffUrl}
        />
      </div>
    </div>
  );
}

function requiresSameDeviceOnly(
  sessionStatus: VerifySessionStatusPayload | null
): boolean {
  return Boolean(
    sessionStatus &&
      !sessionStatus.is_terminal &&
      sessionStatus.status !== "in_progress" &&
      sessionStatus.same_device_only
  );
}

function isRetryableFailureState(
  sessionStatus: VerifySessionStatusPayload | null
): boolean {
  return Boolean(
    sessionStatus &&
      !sessionStatus.is_terminal &&
      sessionStatus.latest_attempt?.status === "failed" &&
      sessionStatus.latest_attempt.retry_allowed
  );
}

function shouldShowHandoff(
  sessionStatus: VerifySessionStatusPayload | null
): boolean {
  return Boolean(
    sessionStatus &&
      !sessionStatus.is_terminal &&
      sessionStatus.status !== "in_progress" &&
      !sessionStatus.same_device_only
  );
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

/**
 * This component is used to inform the user that their device is not supported for Identity Verification with Kayle ID.
 *
 * It provides a QR code for the user to scan to open the session on a mobile device.
 */
export function UnsupportedDevice() {
  const { os } = useDevice();
  const { sessionId } = useLoaderData({
    from: "/$",
  });
  const [handoffPayload, setHandoffPayload] = useState<HandoffPayload | null>(
    null
  );
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<VerifySessionStatusPayload | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
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

      setHandoffError("Unable to generate handoff QR code.");
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
      setHandoffError("Unable to load verification status.");
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
      setHandoffError("Unable to generate handoff QR code.");
    }
  }, [handoffPayload, pollSessionStatus, sessionId]);

  const handleCancelVerification = useCallback(async () => {
    if (
      typeof window !== "undefined" &&
      typeof window.confirm === "function" &&
      !window.confirm(
        "Cancel? This will stop the current verification session."
      )
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
      setHandoffError("Unable to cancel the verification session.");
    }
  }, [sessionId, sessionStatus]);

  const isTerminal = sessionStatus?.is_terminal ?? false;
  const isAwaitingCompletion = sessionStatus?.status === "in_progress";
  const isSameDeviceOnly = requiresSameDeviceOnly(sessionStatus);
  const isRetryableFailure = isRetryableFailureState(sessionStatus);
  const screenContent = useMemo(() => {
    if (isTerminal && terminalContent) {
      return buildTerminalScreenContent({
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
    loadHandoffState().catch(() => {
      // loadHandoffState already stores the error state that the UI renders.
    });
  }, [loadHandoffState]);

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
      <HandoffStateContent
        fetchHandoffPayload={loadHandoffState}
        handoffError={handoffError}
        handoffLoading={handoffLoading || statusLoading}
        handoffUrl={handoffUrl}
        os={os}
      />
    );
  }

  if (redirectTargetUrl) {
    buttons = {
      primary: {
        label: "Continue now",
        onClick: () => {
          redirectToUrl(redirectTargetUrl);
        },
      },
    };
  } else if (isTerminal) {
    buttons = {
      primary: {
        label: "Close this page",
        onClick: () => {
          window.close();
        },
      },
    };
  } else {
    buttons = {
      secondary: {
        label: "Cancel",
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
