import { useCallback, useEffect, useRef, useState } from "react";
import {
	type HandoffPayload,
	requestHandoffPayload,
	requestVerifyRedirectPermitted,
	requestVerifySessionStatus,
	type VerifySessionStatusPayload,
} from "@/api/verify-api";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { isHandoffPayloadExpired, shouldShowHandoff } from "./screen-content";

const HANDOFF_REFRESH_INTERVAL_MS = 60_000;
const STATUS_POLL_INTERVAL_MS = 2000;

// Inlined rather than imported from @/api/verify-api because tests mock that
// module with a narrow export list; pulling additional names from it would
// surface as `undefined` at runtime.
function isStaleSessionCode(error: unknown): boolean {
	if (!(error instanceof Error) || !("code" in error)) {
		return false;
	}
	const code = (error as { code?: unknown }).code;
	return code === "SESSION_IN_PROGRESS" || code === "SESSION_EXPIRED";
}

export type HandoffSessionState = {
	handoffPayload: HandoffPayload | null;
	handoffError: string | null;
	sessionStatus: VerifySessionStatusPayload | null;
	statusLoading: boolean;
	isRedirectPermitted: boolean | null;
	reload: () => Promise<void>;
	setHandoffError: (value: string | null) => void;
	setSessionStatus: (value: VerifySessionStatusPayload | null) => void;
	setHandoffPayload: (value: HandoffPayload | null) => void;
};

export function useHandoffSession({
	sessionId,
	prefetchedSessionStatus,
}: {
	sessionId: string;
	prefetchedSessionStatus: VerifySessionStatusPayload | null;
}): HandoffSessionState {
	const copy = useVerifyHandoffCopy();
	const [handoffPayload, setHandoffPayload] = useState<HandoffPayload | null>(
		null,
	);
	const [handoffError, setHandoffError] = useState<string | null>(null);
	const [sessionStatus, setSessionStatus] =
		useState<VerifySessionStatusPayload | null>(prefetchedSessionStatus);
	const [statusLoading, setStatusLoading] = useState(
		prefetchedSessionStatus === null,
	);
	const [isRedirectPermitted, setIsRedirectPermitted] = useState<
		boolean | null
	>(null);
	const handoffPayloadRef = useRef<HandoffPayload | null>(null);
	handoffPayloadRef.current = handoffPayload;

	const pollSessionStatus = useCallback(async () => {
		try {
			const nextStatus = await requestVerifySessionStatus(sessionId);
			setSessionStatus((current) =>
				current?.is_terminal ? current : nextStatus,
			);
			if (!shouldShowHandoff(nextStatus)) {
				setHandoffPayload(null);
				setHandoffError(null);
			}
			return nextStatus;
		} catch {
			return null;
		}
	}, [sessionId]);

	const loadHandoffPayload = useCallback(
		async ({ keepStaleOk }: { keepStaleOk: boolean }) => {
			try {
				const payload = await requestHandoffPayload(sessionId);
				setHandoffPayload(payload);
				setHandoffError(null);
			} catch (error) {
				if (isStaleSessionCode(error)) {
					await pollSessionStatus();
					return;
				}
				const existing = handoffPayloadRef.current;
				if (
					keepStaleOk &&
					existing &&
					!isHandoffPayloadExpired(existing, Date.now())
				) {
					return;
				}
				setHandoffPayload(null);
				setHandoffError(copy.handoff.refreshError);
			}
		},
		[copy.handoff.refreshError, pollSessionStatus, sessionId],
	);

	const reload = useCallback(async () => {
		setStatusLoading(true);
		const nextStatus = await pollSessionStatus();
		setStatusLoading(false);

		if (!nextStatus) {
			setHandoffPayload(null);
			setHandoffError(copy.handoff.loadStatusError);
			return;
		}
		if (!shouldShowHandoff(nextStatus)) {
			setHandoffPayload(null);
			return;
		}
		await loadHandoffPayload({ keepStaleOk: false });
	}, [copy.handoff.loadStatusError, loadHandoffPayload, pollSessionStatus]);

	const isTerminal = sessionStatus?.is_terminal ?? false;

	useEffect(() => {
		if (isTerminal) {
			return;
		}
		const intervalId = window.setInterval(() => {
			pollSessionStatus().catch(() => {});
		}, STATUS_POLL_INTERVAL_MS);
		return () => window.clearInterval(intervalId);
	}, [isTerminal, pollSessionStatus]);

	useEffect(() => {
		if (!prefetchedSessionStatus) {
			reload().catch(() => {});
			return;
		}
		setSessionStatus(prefetchedSessionStatus);
		setStatusLoading(false);

		if (!shouldShowHandoff(prefetchedSessionStatus)) {
			return;
		}
		loadHandoffPayload({ keepStaleOk: false }).catch(() => {});
	}, [loadHandoffPayload, prefetchedSessionStatus, reload]);

	useEffect(() => {
		if (isTerminal || !shouldShowHandoff(sessionStatus)) {
			return;
		}
		const intervalId = window.setInterval(() => {
			loadHandoffPayload({ keepStaleOk: true }).catch(() => {});
		}, HANDOFF_REFRESH_INTERVAL_MS);
		return () => window.clearInterval(intervalId);
	}, [isTerminal, loadHandoffPayload, sessionStatus]);

	useEffect(() => {
		if (!(sessionStatus?.is_terminal && sessionStatus.redirect_url)) {
			setIsRedirectPermitted(null);
			return;
		}

		let cancelled = false;
		requestVerifyRedirectPermitted(sessionStatus.session_id)
			.then((result) => {
				if (!cancelled) {
					setIsRedirectPermitted(result.permitted);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setIsRedirectPermitted(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [sessionStatus]);

	return {
		handoffPayload,
		handoffError,
		sessionStatus,
		statusLoading,
		isRedirectPermitted,
		reload,
		setHandoffError,
		setSessionStatus,
		setHandoffPayload,
	};
}

export { HANDOFF_REFRESH_INTERVAL_MS, STATUS_POLL_INTERVAL_MS };
