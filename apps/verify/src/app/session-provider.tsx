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
import { buildCancelledSessionStatus } from "@/utils/cancel";
import { useDevice } from "@/utils/use-device";
import { useVerificationStore } from "../stores/session";
import type { Organization } from "./app/organization-name";
import {
	bootstrapSupportedSession,
	closeSessionStub,
	reportCallbackErrorDevOnly,
	shouldStartInHandoff,
	toSessionError,
} from "./session-provider-helpers";

type SessionContextType = {
	isSessionDetailsReady: boolean;
	organization: Organization;
	isAgeOnly: boolean;
	ageThreshold: number | null;
	sessionStatus: VerifySessionStatusPayload | null;
	session: VerifySession | null;
	error: SessionError | null;
	onError: (callback: (sessionError: SessionError) => void) => () => void;
	markSessionCancelled: () => void;
};

const EMPTY_ORGANIZATION: Organization = {
	name: null,
	ownerIdCheckCompleted: false,
	verifiedApexDomains: [],
	logo: null,
	businessType: null,
	businessName: null,
	businessJurisdiction: null,
	businessRegistrationNumber: null,
	privacyPolicyUrl: null,
	termsOfServiceUrl: null,
	website: null,
	description: null,
};

const SessionContext = createContext<SessionContextType | undefined>(undefined);

type SessionProviderProps = {
	sessionId: string;
	children: ReactNode;
};

export function SessionProvider({ sessionId, children }: SessionProviderProps) {
	const { supported: deviceSupported } = useDevice();
	const [isSessionDetailsReady, setIsSessionDetailsReady] = useState(false);
	const [organization, setOrganization] =
		useState<Organization>(EMPTY_ORGANIZATION);
	const [isAgeOnly, setIsAgeOnly] = useState(false);
	const [ageThreshold, setAgeThreshold] = useState<number | null>(null);
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
		setSessionStatus(null);

		Promise.all([
			requestVerifySessionDetails(sessionId),
			requestVerifySessionStatus(sessionId),
		])
			.then(([details, nextSessionStatus]) => {
				if (isStale) {
					return;
				}

				setOrganization({
					name: details.organization_name,
					ownerIdCheckCompleted: details.organization_owner_id_check_completed,
					verifiedApexDomains: details.organization_verified_apex_domains,
					logo: details.organization_logo,
					businessType: details.organization_business_type,
					businessName: details.organization_business_name,
					businessJurisdiction: details.organization_business_jurisdiction,
					businessRegistrationNumber:
						details.organization_business_registration_number,
					privacyPolicyUrl: details.organization_privacy_policy_url,
					termsOfServiceUrl: details.organization_terms_of_service_url,
					website: details.organization_website,
					description: details.organization_description,
				});
				setIsAgeOnly(details.is_age_only);
				setAgeThreshold(details.age_threshold);
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
			organization,
			isAgeOnly,
			ageThreshold,
			sessionStatus,
			session: isSessionReady ? sessionStubRef.current : null,
			error,
			onError,
			markSessionCancelled,
		}),
		[
			isSessionDetailsReady,
			organization,
			isAgeOnly,
			ageThreshold,
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
