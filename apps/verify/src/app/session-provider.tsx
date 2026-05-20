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
import type { SessionError, VerifySession } from "@/api/session-socket";
import {
	requestVerifySessionDetails,
	requestVerifySessionStatus,
	type VerifySessionShareFields,
	type VerifySessionStatusPayload,
} from "@/api/verify-api";
import { useDevice } from "@/hooks/use-device";
import {
	EMPTY_ORGANIZATION,
	type Organization,
	toOrganization,
} from "@/screens/organization/types";
import { buildCancelledSessionStatus } from "@/utils/cancel";
import { useVerificationStore } from "../stores/session";
import {
	bootstrapSupportedSession,
	closeSessionStub,
	reportCallbackErrorDevOnly,
	shouldStartInHandoff,
	toSessionError,
} from "./session-provider-helpers";

type SessionContextType = {
	sessionId: string;
	isSessionDetailsReady: boolean;
	organization: Organization;
	isAgeOnly: boolean;
	ageThreshold: number | null;
	shareFields: VerifySessionShareFields;
	sessionStatus: VerifySessionStatusPayload | null;
	session: VerifySession | null;
	error: SessionError | null;
	onError: (callback: (sessionError: SessionError) => void) => () => void;
	markSessionCancelled: () => void;
};

const EMPTY_SHARE_FIELDS: VerifySessionShareFields = {};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({
	sessionId,
	children,
}: {
	sessionId: string;
	children: ReactNode;
}) {
	const { supported: deviceSupported } = useDevice();
	const [isSessionDetailsReady, setIsSessionDetailsReady] = useState(false);
	const [organization, setOrganization] =
		useState<Organization>(EMPTY_ORGANIZATION);
	const [isAgeOnly, setIsAgeOnly] = useState(false);
	const [ageThreshold, setAgeThreshold] = useState<number | null>(null);
	const [shareFields, setShareFields] =
		useState<VerifySessionShareFields>(EMPTY_SHARE_FIELDS);
	const [sessionStatus, setSessionStatus] =
		useState<VerifySessionStatusPayload | null>(null);
	const [isSessionReady, setIsSessionReady] = useState(false);
	const [error, setError] = useState<SessionError | null>(null);
	const errorCallbacksRef = useRef<Set<(sessionError: SessionError) => void>>(
		new Set(),
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
		[],
	);

	const markSessionCancelled = useCallback(() => {
		setSessionStatus((current) =>
			buildCancelledSessionStatus({
				sessionId,
				sessionStatus: current,
			}),
		);
	}, [sessionId]);

	const handleRpcError = useCallback(
		(sessionError: SessionError) => {
			setIsSessionReady(false);
			setError(sessionError);
			notifyErrorCallbacks(sessionError);
		},
		[notifyErrorCallbacks],
	);

	useEffect(() => {
		let isStale = false;

		setIsSessionDetailsReady(false);
		setOrganization(EMPTY_ORGANIZATION);
		setIsAgeOnly(false);
		setAgeThreshold(null);
		setShareFields(EMPTY_SHARE_FIELDS);
		setSessionStatus(null);

		Promise.all([
			requestVerifySessionDetails(sessionId),
			requestVerifySessionStatus(sessionId),
		])
			.then(([details, nextSessionStatus]) => {
				if (isStale) {
					return;
				}

				setOrganization(toOrganization(details));
				setIsAgeOnly(details.is_age_only);
				setAgeThreshold(details.age_threshold);
				setShareFields(details.share_fields);
				setSessionStatus(nextSessionStatus);

				const showUnverifiedWarning =
					details.organization_verified_apex_domains.length === 0 &&
					!details.is_age_only;
				useVerificationStore.setState({
					step: shouldStartInHandoff(nextSessionStatus)
						? "handoff"
						: showUnverifiedWarning
							? "unverified_org_warning"
							: "explain",
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
		setIsSessionReady(false);
		setError(null);
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

		return () => {
			isUnmountedRef.current = true;
			closeSessionStub(sessionStubRef);
		};
	}, [deviceSupported, sessionId, handleRpcError]);

	const value: SessionContextType = useMemo(
		() => ({
			sessionId,
			isSessionDetailsReady,
			organization,
			isAgeOnly,
			ageThreshold,
			shareFields,
			sessionStatus,
			session: isSessionReady ? sessionStubRef.current : null,
			error,
			onError,
			markSessionCancelled,
		}),
		[
			sessionId,
			isSessionDetailsReady,
			organization,
			isAgeOnly,
			ageThreshold,
			shareFields,
			sessionStatus,
			isSessionReady,
			error,
			onError,
			markSessionCancelled,
		],
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
