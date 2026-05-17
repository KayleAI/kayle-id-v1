import {
	canRenderWithoutSession,
	useVerificationStore,
} from "../../stores/session";
import { ErrorCard } from "../error";
import { useSession } from "../session-provider";
import { SessionConsent } from "./consent";
import { SessionExplain } from "./explain";
import { Handoff } from "./handoff";
import { UnverifiedOrgWarning } from "./unverified-org-warning";

export function SessionApp() {
	const {
		ageThreshold,
		error,
		isAgeOnly,
		isSessionDetailsReady,
		markSessionCancelled,
		organization,
		session,
		sessionId,
	} = useSession();
	const step = useVerificationStore((state) => state.step);

	if (error) {
		return null;
	}

	if (!isSessionDetailsReady) {
		return null;
	}

	if (!session && !canRenderWithoutSession(step)) {
		return null;
	}

	switch (step) {
		case "unverified_org_warning":
			return <UnverifiedOrgWarning organization={organization} />;
		case "explain":
			return (
				<SessionExplain
					ageThreshold={ageThreshold}
					isAgeOnly={isAgeOnly}
					organization={organization}
				/>
			);
		case "consent":
			return (
				<SessionConsent
					ageThreshold={ageThreshold}
					isAgeOnly={isAgeOnly}
					onSessionCancelled={markSessionCancelled}
					organization={organization}
					sessionId={sessionId}
				/>
			);
		case "handoff":
			return <Handoff />;
		default:
			return (
				<ErrorCard error={{ code: "UNKNOWN", message: "Unknown error" }} />
			);
	}
}
