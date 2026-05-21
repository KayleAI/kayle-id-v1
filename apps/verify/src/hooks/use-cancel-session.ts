import { useCallback, useState } from "react";
import { requestCancelVerifySession } from "@/api/verify-api";

type CancelState = "idle" | "pending" | "succeeded" | "failed";

export function useCancelSession(sessionId: string) {
	const [state, setState] = useState<CancelState>("idle");

	const cancel = useCallback(
		async (cancelToken: string | null): Promise<boolean> => {
			if (!cancelToken || state === "pending") {
				return false;
			}

			setState("pending");
			try {
				await requestCancelVerifySession(sessionId, cancelToken);
				setState("succeeded");
				return true;
			} catch {
				setState("failed");
				return false;
			}
		},
		[sessionId, state],
	);

	return { state, cancel, setState };
}
