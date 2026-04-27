import {
	canRenderWithoutSession,
	useVerificationStore,
} from "../../stores/session";
import { ErrorCard } from "../error";
import { useSession } from "../session-provider";
import { SessionConsent } from "./consent";
import { SessionExplain } from "./explain";
import { Handoff } from "./handoff";

export function SessionApp() {
	const { error, isSessionDetailsReady, organizationName, session } =
		useSession();
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
		case "explain":
			return <SessionExplain organizationName={organizationName} />;
		case "consent":
			return <SessionConsent organizationName={organizationName} />;
		case "handoff":
			return <Handoff />;
		default:
			return (
				<ErrorCard error={{ code: "UNKNOWN", message: "Unknown error" }} />
			);
	}
}
