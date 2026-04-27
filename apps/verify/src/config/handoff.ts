export type HandoffPayload = {
	v: number;
	session_id: string;
	attempt_id: string;
	mobile_write_token: string;
	expires_at: string;
};

export type VerifySessionStatusPayload = {
	completed_at: string | null;
	is_terminal: boolean;
	latest_attempt: {
		completed_at: string | null;
		failure_code: string | null;
		handoff_claimed: boolean;
		id: string;
		retry_allowed: boolean;
		status: "cancelled" | "failed" | "in_progress" | "succeeded";
	} | null;
	redirect_url: string | null;
	session_id: string;
	same_device_only: boolean;
	status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
};

export type VerifySessionDetailsPayload = {
	organization_name: string;
	session_id: string;
};

type VerifyApiError = {
	code: string;
	message: string;
};

type VerifyApiResponse<T> = {
	data: T | null;
	error: VerifyApiError | null;
};

type VerifyRequestError = Error & {
	code: string;
};

function createVerifyRequestError(
	code: string,
	message: string,
): VerifyRequestError {
	const error = new Error(message) as VerifyRequestError;
	error.code = code;
	return error;
}

export async function requestHandoffPayload(
	sessionId: string,
): Promise<HandoffPayload> {
	const response = await fetch(`/v1/verify/session/${sessionId}/handoff`, {
		method: "POST",
	});

	const payload = (await response.json()) as VerifyApiResponse<HandoffPayload>;

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? "UNKNOWN",
			payload.error?.message ?? "Failed to fetch handoff credentials.",
		);
	}

	return payload.data;
}

export async function requestVerifySessionStatus(
	sessionId: string,
): Promise<VerifySessionStatusPayload> {
	const response = await fetch(`/v1/verify/session/${sessionId}/status`, {
		method: "GET",
	});

	const payload =
		(await response.json()) as VerifyApiResponse<VerifySessionStatusPayload>;

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? "UNKNOWN",
			payload.error?.message ?? "Failed to fetch verification session status.",
		);
	}

	return payload.data;
}

export async function requestVerifySessionDetails(
	sessionId: string,
): Promise<VerifySessionDetailsPayload> {
	const response = await fetch(`/v1/verify/session/${sessionId}/details`, {
		method: "GET",
	});

	const payload =
		(await response.json()) as VerifyApiResponse<VerifySessionDetailsPayload>;

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? "UNKNOWN",
			payload.error?.message ?? "Failed to fetch verification session details.",
		);
	}

	return payload.data;
}

export async function requestCancelVerifySession(
	sessionId: string,
): Promise<void> {
	const response = await fetch(`/v1/verify/session/${sessionId}/cancel`, {
		method: "POST",
	});

	if (response.status === 204) {
		return;
	}

	const payload = (await response.json()) as VerifyApiResponse<null>;

	throw createVerifyRequestError(
		payload.error?.code ?? "UNKNOWN",
		payload.error?.message ?? "Failed to cancel the verification session.",
	);
}
