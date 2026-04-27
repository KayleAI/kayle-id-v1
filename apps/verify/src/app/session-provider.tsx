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
import type { SessionError, VerifySession } from "@/config/capnp";
import {
  requestVerifySessionDetails,
  requestVerifySessionStatus,
  type VerifySessionStatusPayload,
} from "@/config/handoff";
import {
  bootstrapSupportedSession,
  closeSessionStub,
  reportCallbackErrorDevOnly,
  shouldStartInHandoff,
  toSessionError,
} from "./session-provider-helpers";
import { useVerificationStore } from "../stores/session";
import { useDevice } from "@/utils/use-device";

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
