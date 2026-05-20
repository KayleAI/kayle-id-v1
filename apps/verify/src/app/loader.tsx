import { Spinner } from "@kayle-id/ui/components/spinner";
import { useDevice } from "@/hooks/use-device";
import {
	canRenderWithoutSession,
	useVerificationStore,
} from "../stores/session";
import { useSession } from "./session-provider";

const SPINNER_WRAPPER_CLASS =
	"flex h-full w-full flex-1 grow items-center justify-center";

export function SessionLoader() {
	const { supported: deviceSupported } = useDevice();
	const { isSessionDetailsReady, session, error } = useSession();
	const step = useVerificationStore((state) => state.step);

	if (error) {
		return null;
	}

	if (!isSessionDetailsReady) {
		return (
			<div className={SPINNER_WRAPPER_CLASS}>
				<Spinner className="size-9 animate-spin" />
			</div>
		);
	}

	if (!deviceSupported || canRenderWithoutSession(step) || session) {
		return null;
	}

	return (
		<div className={SPINNER_WRAPPER_CLASS}>
			<Spinner className="size-9 animate-spin" />
		</div>
	);
}
