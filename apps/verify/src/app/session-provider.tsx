import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  HelloCredentials,
  SessionError,
  VerifySession,
} from "@/config/capnp";
import { initialiseSession } from "@/config/capnp";
import {
  requestHandoffPayload,
  requestVerifySessionDetails,
  requestVerifySessionStatus,
  type VerifySessionStatusPayload,
} from "@/config/handoff";
import { useVerificationStore } from "../stores/session";
import { useDevice } from "@/utils/use-device";

const WEB_DEVICE_ID_STORAGE_KEY = "kayle-id.verify.web-device-id";
const WEB_APP_VERSION = "verify-web";

function isErrorWithCode(
  value: unknown
): value is { code: string; message?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function toSessionError(value: unknown): SessionError {
  if (isErrorWithCode(value)) {
    return {
      code: value.code,
      message: value.message ?? value.code,
    };
  }

  if (value instanceof Error) {
    return {
      code: "UNKNOWN",
      message: value.message,
    };
  }

  return {
    code: "UNKNOWN",
    message: "Failed to initialise the verification session.",
  };
}

function getWebDeviceId(): string {
  if (typeof window === "undefined") {
    return `web-${crypto.randomUUID()}`;
  }

  try {
    const existing = window.localStorage.getItem(WEB_DEVICE_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const generated = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem(WEB_DEVICE_ID_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

function toHelloCredentials(payload: {
  attempt_id: string;
  mobile_write_token: string;
}): HelloCredentials {
  return {
    attemptId: payload.attempt_id,
    mobileWriteToken: payload.mobile_write_token,
    deviceId: getWebDeviceId(),
    appVersion: WEB_APP_VERSION,
  };
}

function closeSessionStub(sessionStubRef: { current: VerifySession | null }) {
  if (!sessionStubRef.current) {
    return;
  }

  sessionStubRef.current.close();
  sessionStubRef.current = null;
}

function reportCallbackErrorDevOnly(error: unknown): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const callbackError =
    error instanceof Error ? error : new Error("session_error_callback_failed");

  queueMicrotask(() => {
    throw callbackError;
  });
}

async function bootstrapSupportedSession({
  sessionId,
  handleRpcError,
  isUnmountedRef,
  sessionStubRef,
  setIsSessionReady,
  setError,
}: {
  sessionId: string;
  handleRpcError: (sessionError: SessionError) => void;
  isUnmountedRef: { current: boolean };
  sessionStubRef: { current: VerifySession | null };
  setIsSessionReady: (value: boolean) => void;
  setError: (value: SessionError | null) => void;
}) {
  try {
    const handoffPayload = await requestHandoffPayload(sessionId);
    if (isUnmountedRef.current) {
      return;
    }

    const stub = initialiseSession(
      {
        sessionId,
        helloCredentials: toHelloCredentials(handoffPayload),
      },
      handleRpcError
    );
    sessionStubRef.current = stub;

    await stub.connect();
    const pingResult = await stub.ping();
    if (!pingResult) {
      throw new Error("Invalid ping response");
    }

    if (isUnmountedRef.current) {
      return;
    }

    setIsSessionReady(true);
    setError(null);
  } catch (bootstrapError) {
    if (isUnmountedRef.current) {
      return;
    }
    handleRpcError(toSessionError(bootstrapError));
  }
}

function shouldStartInHandoff(
  sessionStatus: VerifySessionStatusPayload
): boolean {
  return !(
    sessionStatus.status === "created" &&
    sessionStatus.latest_attempt === null &&
    !sessionStatus.same_device_only
  );
}

type SessionContextType = {
  isSessionDetailsReady: boolean;
  organizationName: string | null;
  sessionStatus: VerifySessionStatusPayload | null;
  session: VerifySession | null;
  error: SessionError | null;
  onError: (callback: (sessionError: SessionError) => void) => () => void;
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

type SessionProviderProps = {
  sessionId: string;
  children: ReactNode;
};

export function SessionProvider({ sessionId, children }: SessionProviderProps) {
  const { supported: deviceSupported } = useDevice();
  const [isSessionDetailsReady, setIsSessionDetailsReady] = useState(false);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] =
    useState<VerifySessionStatusPayload | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [error, setError] = useState<SessionError | null>(null);
  const errorCallbacksRef = useRef<Set<(sessionError: SessionError) => void>>(
    new Set()
  );
  const sessionStubRef = useRef<VerifySession | null>(null);

  const notifyErrorCallbacks = useCallback((sessionError: SessionError) => {
    for (const callback of errorCallbacksRef.current) {
      try {
        callback(sessionError);
      } catch (callbackErr) {
        reportCallbackErrorDevOnly(callbackErr);
      }
    }
  }, []);

  const onError = useCallback(
    (callback: (sessionError: SessionError) => void) => {
      errorCallbacksRef.current.add(callback);
      return () => {
        errorCallbacksRef.current.delete(callback);
      };
    },
    []
  );

  const handleRpcError = useCallback(
    (sessionError: SessionError) => {
      setIsSessionReady(false);
      setError(sessionError);
      notifyErrorCallbacks(sessionError);
    },
    [notifyErrorCallbacks]
  );

  useEffect(() => {
    let isStale = false;

    setIsSessionDetailsReady(false);
    setOrganizationName(null);
    setSessionStatus(null);

    Promise.all([
      requestVerifySessionDetails(sessionId),
      requestVerifySessionStatus(sessionId),
    ])
      .then(([details, nextSessionStatus]) => {
        if (isStale) {
          return;
        }

        setOrganizationName(details.organization_name);
        setSessionStatus(nextSessionStatus);
        useVerificationStore.setState({
          step: shouldStartInHandoff(nextSessionStatus) ? "handoff" : "explain",
        });
        setIsSessionDetailsReady(true);
      })
      .catch((detailsError) => {
        if (isStale) {
          return;
        }

        setIsSessionDetailsReady(true);
        handleRpcError(toSessionError(detailsError));
      });

    return () => {
      isStale = true;
    };
  }, [handleRpcError, sessionId]);

  useEffect(() => {
    // Reset state when sessionId changes
    setIsSessionReady(false);
    setError(null);

    // Dispose previous stub if it exists
    closeSessionStub(sessionStubRef);

    if (!deviceSupported) {
      return;
    }

    const isUnmountedRef = { current: false };

    bootstrapSupportedSession({
      sessionId,
      handleRpcError,
      isUnmountedRef,
      sessionStubRef,
      setIsSessionReady,
      setError,
    });

    // Cleanup function
    return () => {
      isUnmountedRef.current = true;
      closeSessionStub(sessionStubRef);
    };
  }, [deviceSupported, sessionId, handleRpcError]);

    // Memoize the context value, providing session from ref only when ready
  const value: SessionContextType = useMemo(
    () => ({
      isSessionDetailsReady,
      organizationName,
      sessionStatus,
      session: isSessionReady ? sessionStubRef.current : null,
      error,
      onError,
    }),
    [
      isSessionDetailsReady,
      organizationName,
      sessionStatus,
      isSessionReady,
      error,
      onError,
    ]
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
