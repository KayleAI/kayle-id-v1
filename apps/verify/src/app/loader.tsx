import { Spinner } from "@kayleai/ui/spinner";
import {
  canRenderWithoutSession,
  useVerificationStore,
} from "../stores/session";
import { useDevice } from "@/utils/use-device";
import { useSession } from "./session-provider";

export function SessionLoader() {
  const { supported: deviceSupported } = useDevice();
  const { isSessionDetailsReady, session, error } = useSession();
  const step = useVerificationStore((state) => state.step);

  if (error) {
    return null;
  }

  if (!isSessionDetailsReady) {
    return (
      <div className="flex h-full w-full flex-1 grow items-center justify-center">
        <Spinner className="size-9 animate-spin" />
      </div>
    );
  }

  if (!deviceSupported || canRenderWithoutSession(step)) {
    return null;
  }

  if (session) {
    return null;
  }

  return (
    <div className="flex h-full w-full flex-1 grow items-center justify-center">
      <Spinner className="size-9 animate-spin" />
    </div>
  );
}
