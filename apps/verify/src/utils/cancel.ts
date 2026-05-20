import type { VerifySessionStatusPayload } from "@/api/verify-api";

export function readCancelTokenFromLocation(): string | null {
	if (typeof window === "undefined") {
		return null;
	}

	const value = new URLSearchParams(window.location.search).get("cancel_token");
	return value && value.length > 0 ? value : null;
}

export function buildCancelledSessionStatus({
	sessionId,
	sessionStatus,
}: {
	sessionId: string;
	sessionStatus: VerifySessionStatusPayload | null;
}): VerifySessionStatusPayload {
	return {
		completed_at: new Date().toISOString(),
		is_terminal: true,
		latest_attempt: sessionStatus?.latest_attempt
			? {
					...sessionStatus.latest_attempt,
					retry_allowed: false,
				}
			: null,
		redirect_url: null,
		session_id: sessionId,
		same_device_only: sessionStatus?.same_device_only ?? false,
		status: "cancelled",
	};
}
