export type HandoffPayload = {
	v: number;
	session_id: string;
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
	status:
		| "cancelled"
		| "created"
		| "expired"
		| "failed"
		| "in_progress"
		| "succeeded";
};

export type VerifySessionShareField = {
	required: boolean;
	reason: string;
	source: "default" | "rc";
};

export type VerifySessionShareFields = Record<string, VerifySessionShareField>;

export type VerifySessionDetailsPayload = {
	organization_id: string;
	organization_name: string;
	organization_owner_id_check_completed: boolean;
	organization_verified_apex_domains: string[];
	organization_business_type: "sole" | "business" | null;
	organization_logo: string | null;
	organization_business_name: string | null;
	organization_business_jurisdiction: string | null;
	organization_business_registration_number: string | null;
	organization_privacy_policy_url: string | null;
	organization_terms_of_service_url: string | null;
	organization_website: string | null;
	organization_description: string | null;
	rp_fallback: {
		appeal_url: string | null;
		complaints_url: string | null;
		fallback_idv_url: string | null;
		support_email: string | null;
	};
	session_id: string;
	is_age_only: boolean;
	age_threshold: number | null;
	share_fields: VerifySessionShareFields;
};

export type RecordVerifyConsentInput = {
	biometric_consent: true;
	document_processing_consent: true;
	privacy_notice_acknowledged: true;
	share_claims_consent: true;
	terms_acknowledged: true;
};

export type RecordVerifyConsentPayload = {
	consent_id: string;
	consented_at: string;
};

export type VerifyRedirectPermittedPayload = {
	permitted: boolean;
	redirect_url: string | null;
};

export type VerifyRequestError = Error & { code: string };

type VerifyApiError = {
	code: string;
	message: string;
};

type VerifyApiResponse<T> = {
	data: T | null;
	error: VerifyApiError | null;
};

const UNKNOWN_ERROR_CODE = "UNKNOWN";

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isVerifyRequestError(
	value: unknown,
): value is VerifyRequestError {
	return (
		value instanceof Error &&
		"code" in value &&
		typeof (value as { code?: unknown }).code === "string"
	);
}

function createVerifyRequestError(
	code: string,
	message: string,
): VerifyRequestError {
	const error = new Error(message) as VerifyRequestError;
	error.code = code;
	return error;
}

function parseVerifyApiError(value: unknown): VerifyApiError | null {
	if (!isRecord(value)) {
		return null;
	}

	const { code, message } = value;
	if (typeof code !== "string") {
		return null;
	}

	return {
		code,
		message: typeof message === "string" ? message : code,
	};
}

async function readVerifyApiResponse<T>(
	response: Response,
	defaultMessage: string,
): Promise<VerifyApiResponse<T>> {
	const fallbackEnvelope: VerifyApiResponse<T> = {
		data: null,
		error: { code: UNKNOWN_ERROR_CODE, message: defaultMessage },
	};

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return fallbackEnvelope;
	}

	if (!isRecord(payload)) {
		return fallbackEnvelope;
	}

	return {
		data: payload.data === undefined ? null : (payload.data as T | null),
		error: parseVerifyApiError(payload.error),
	};
}

async function verifyApiRequest<T>(
	path: string,
	defaultErrorMessage: string,
	init: RequestInit = { method: "GET" },
): Promise<T> {
	const response = await fetch(path, init);
	const payload = await readVerifyApiResponse<T>(response, defaultErrorMessage);

	if (!(response.ok && payload.data) || payload.error) {
		throw createVerifyRequestError(
			payload.error?.code ?? UNKNOWN_ERROR_CODE,
			payload.error?.message ?? defaultErrorMessage,
		);
	}

	return payload.data;
}

const sessionPath = (sessionId: string, suffix: string) =>
	`/v1/verify/session/${sessionId}/${suffix}`;

const jsonPost = (body: unknown): RequestInit => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(body),
});

export function requestHandoffPayload(
	sessionId: string,
): Promise<HandoffPayload> {
	return verifyApiRequest<HandoffPayload>(
		sessionPath(sessionId, "handoff"),
		"Failed to fetch handoff credentials.",
		{ method: "POST" },
	);
}

export function requestVerifySessionStatus(
	sessionId: string,
): Promise<VerifySessionStatusPayload> {
	return verifyApiRequest<VerifySessionStatusPayload>(
		sessionPath(sessionId, "status"),
		"Failed to fetch verification session status.",
	);
}

export function requestVerifySessionDetails(
	sessionId: string,
): Promise<VerifySessionDetailsPayload> {
	return verifyApiRequest<VerifySessionDetailsPayload>(
		sessionPath(sessionId, "details"),
		"Failed to fetch verification session details.",
	);
}

export function requestRecordVerifyConsent(
	sessionId: string,
	input: RecordVerifyConsentInput,
): Promise<RecordVerifyConsentPayload> {
	return verifyApiRequest<RecordVerifyConsentPayload>(
		sessionPath(sessionId, "consent"),
		"Failed to record verification consent.",
		jsonPost(input),
	);
}

export function requestVerifyRedirectPermitted(
	sessionId: string,
): Promise<VerifyRedirectPermittedPayload> {
	return verifyApiRequest<VerifyRedirectPermittedPayload>(
		sessionPath(sessionId, "redirect-permitted"),
		"Failed to verify redirect URL.",
	);
}

export async function requestCancelVerifySession(
	sessionId: string,
	cancelToken: string,
): Promise<void> {
	const response = await fetch(
		sessionPath(sessionId, "cancel"),
		jsonPost({ cancel_token: cancelToken }),
	);

	if (response.status === 204) {
		return;
	}

	const defaultMessage = "Failed to cancel the verification session.";
	const payload = await readVerifyApiResponse<null>(response, defaultMessage);

	throw createVerifyRequestError(
		payload.error?.code ?? UNKNOWN_ERROR_CODE,
		payload.error?.message ?? defaultMessage,
	);
}
