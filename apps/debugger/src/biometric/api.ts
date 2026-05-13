import {
	type BiometricVerifierFaceMatchResponse,
	type BiometricVerifierResponsePayload,
	biometricVerifierFaceMatchResponseSchema,
	biometricVerifierResponseSchema,
	createBiometricVerifierFaceMatchFormData,
	createBiometricVerifierRequestFormData,
} from "@kayle-id/config/biometric-verifier";

export type VerifyRequest = {
	dg2Image: Uint8Array;
	video: Uint8Array;
	faceMatchThreshold?: number;
	includeDebug: boolean;
	skipFaceMatch: boolean;
};

export type VerifyOutcome =
	| { kind: "ok"; response: BiometricVerifierResponsePayload }
	| { kind: "error"; status: number | null; message: string; raw?: string };

// Same-origin proxy. The Vite dev server forwards `/verifier/*` to the
// local wrangler dev of the biometric verifier, attaching the shared
// secret server-side so the browser bundle stays secret-free.
const VERIFIER_URL = "/verifier/verify_liveness";
const FACE_MATCH_URL = "/verifier/verify_face_match";

export async function verifyLiveness(
	request: VerifyRequest,
): Promise<VerifyOutcome> {
	let formData: FormData;
	try {
		formData = createBiometricVerifierRequestFormData({
			dg2Image: request.dg2Image,
			video: request.video,
			faceMatchThreshold: request.faceMatchThreshold,
			includeDebug: request.includeDebug,
			skipFaceMatch: request.skipFaceMatch,
		});
	} catch (error) {
		return {
			kind: "error",
			status: null,
			message: `request_invalid:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let response: Response;
	try {
		response = await fetch(VERIFIER_URL, {
			method: "POST",
			body: formData,
		});
	} catch (error) {
		return {
			kind: "error",
			status: null,
			message: `network_error:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const rawText = await response.text();
	let json: unknown;
	try {
		json = JSON.parse(rawText);
	} catch {
		return {
			kind: "error",
			status: response.status,
			message: "verifier_returned_non_json",
			raw: rawText,
		};
	}

	if (!response.ok) {
		const errorMessage =
			typeof json === "object" &&
			json !== null &&
			"error" in json &&
			typeof (json as { error?: { message?: string } }).error?.message ===
				"string"
				? (json as { error: { message: string } }).error.message
				: `verifier_http_${response.status}`;
		return {
			kind: "error",
			status: response.status,
			message: errorMessage,
			raw: rawText,
		};
	}

	const parsed = biometricVerifierResponseSchema.safeParse(json);
	if (!parsed.success) {
		return {
			kind: "error",
			status: response.status,
			message: "verifier_response_schema_invalid",
			raw: rawText,
		};
	}

	return { kind: "ok", response: parsed.data };
}

export type FaceMatchRequest = {
	dg2Image: Uint8Array;
	selfies: Uint8Array[];
	faceMatchThreshold?: number;
	includeDebug: boolean;
};

export type FaceMatchOutcome =
	| { kind: "ok"; response: BiometricVerifierFaceMatchResponse }
	| { kind: "error"; status: number | null; message: string; raw?: string };

export async function verifyFaceMatch(
	request: FaceMatchRequest,
): Promise<FaceMatchOutcome> {
	let formData: FormData;
	try {
		formData = createBiometricVerifierFaceMatchFormData({
			dg2Image: request.dg2Image,
			selfies: request.selfies,
			faceMatchThreshold: request.faceMatchThreshold,
			includeDebug: request.includeDebug,
		});
	} catch (error) {
		return {
			kind: "error",
			status: null,
			message: `request_invalid:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	let response: Response;
	try {
		response = await fetch(FACE_MATCH_URL, {
			method: "POST",
			body: formData,
		});
	} catch (error) {
		return {
			kind: "error",
			status: null,
			message: `network_error:${error instanceof Error ? error.message : String(error)}`,
		};
	}

	const rawText = await response.text();
	let json: unknown;
	try {
		json = JSON.parse(rawText);
	} catch {
		return {
			kind: "error",
			status: response.status,
			message: "verifier_returned_non_json",
			raw: rawText,
		};
	}

	if (!response.ok) {
		const errorMessage =
			typeof json === "object" &&
			json !== null &&
			"error" in json &&
			typeof (json as { error?: { message?: string } }).error?.message ===
				"string"
				? (json as { error: { message: string } }).error.message
				: `verifier_http_${response.status}`;
		return {
			kind: "error",
			status: response.status,
			message: errorMessage,
			raw: rawText,
		};
	}

	const parsed = biometricVerifierFaceMatchResponseSchema.safeParse(json);
	if (!parsed.success) {
		return {
			kind: "error",
			status: response.status,
			message: "verifier_response_schema_invalid",
			raw: rawText,
		};
	}
	return { kind: "ok", response: parsed.data };
}
