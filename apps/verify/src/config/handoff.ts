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
	organization_verified: boolean;
	organization_logo: string | null;
	organization_business_name: string | null;
	organization_business_jurisdiction: string | null;
	organization_business_registration_number: string | null;
	organization_privacy_policy_url: string | null;
	organization_terms_of_service_url: string | null;
	organization_website: string | null;
	organization_description: string | null;
	session_id: string;
	is_age_only: boolean;
	age_threshold: number | null;
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

const UNKNOWN_ERROR_CODE = "UNKNOWN";
const HANDOFF_ERROR_MESSAGE = "Failed to fetch handoff credentials.";
const SESSION_STATUS_ERROR_MESSAGE =
	"Failed to fetch verification session status.";
const SESSION_DETAILS_ERROR_MESSAGE =
	"Failed to fetch verification session details.";
const CANCEL_SESSION_ERROR_MESSAGE =
	"Failed to cancel the verification session.";

function createVerifyRequestError(
	code: string,
	message: string,
): VerifyRequestError {
	const error = new Error(message) as VerifyRequestError;
	error.code = code;
	return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseVerifyApiError(value: unknown): VerifyApiError | null {
	if (!isRecord(value)) {
		return null;
	}

	const { code, message } = value;

	return typeof code === "string"
		? {
				code,
				message: typeof message === "string" ? message : code,
			}
		: null;
}

async function readVerifyApiResponse<T>(
	response: Response,
	defaultMessage: string,
): Promise<VerifyApiResponse<T>> {
	let payload: unknown;

	try {
		payload = await response.json();
	} catch {
		return {
			data: null,
			error: {
				code: UNKNOWN_ERROR_CODE,
				message: defaultMessage,
			},
		};
	}

	if (!isRecord(payload)) {
		return {
			data: null,
			error: {
				code: UNKNOWN_ERROR_CODE,
				message: defaultMessage,
			},
		};
	}

	const error = parseVerifyApiError(payload.error);

	return {
		data: payload.data === undefined ? null : (payload.data as T | null),
		error,
	};
}

export async function requestHandoffPayload(
	sessionId: string,
): Promise<HandoffPayload> {
	const response = await fetch(`/v1/verify/session/${sessionId}/handoff`, {
		method: "POST",
	});

	const payload = await readVerifyApiResponse<HandoffPayload>(
		response,
		HANDOFF_ERROR_MESSAGE,
	);

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? UNKNOWN_ERROR_CODE,
			payload.error?.message ?? HANDOFF_ERROR_MESSAGE,
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

	const payload = await readVerifyApiResponse<VerifySessionStatusPayload>(
		response,
		SESSION_STATUS_ERROR_MESSAGE,
	);

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? UNKNOWN_ERROR_CODE,
			payload.error?.message ?? SESSION_STATUS_ERROR_MESSAGE,
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

	const payload = await readVerifyApiResponse<VerifySessionDetailsPayload>(
		response,
		SESSION_DETAILS_ERROR_MESSAGE,
	);

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? UNKNOWN_ERROR_CODE,
			payload.error?.message ?? SESSION_DETAILS_ERROR_MESSAGE,
		);
	}

	return payload.data;
}

export async function requestCancelVerifySession(
	sessionId: string,
	cancelToken: string,
): Promise<void> {
	const response = await fetch(`/v1/verify/session/${sessionId}/cancel`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ cancel_token: cancelToken }),
	});

	if (response.status === 204) {
		return;
	}

	const payload = await readVerifyApiResponse<null>(
		response,
		CANCEL_SESSION_ERROR_MESSAGE,
	);

	throw createVerifyRequestError(
		payload.error?.code ?? UNKNOWN_ERROR_CODE,
		payload.error?.message ?? CANCEL_SESSION_ERROR_MESSAGE,
	);
}
