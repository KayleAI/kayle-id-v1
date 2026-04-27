import type {
	HelloCredentials,
	SessionError,
	VerifySession,
} from "@/config/capnp";
import { initialiseSession } from "@/config/capnp";
import {
	requestHandoffPayload,
	type VerifySessionStatusPayload,
} from "@/config/handoff";

const WEB_DEVICE_ID_STORAGE_KEY = "kayle-id.verify.web-device-id";
const WEB_APP_VERSION = "verify-web";

function isErrorWithCode(
	value: unknown,
): value is { code: string; message?: string } {
	return (
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		typeof (value as { code?: unknown }).code === "string"
	);
}

export function toSessionError(value: unknown): SessionError {
	if (isErrorWithCode(value)) {
		return {
			code: value.code,
			message: value.message ?? value.code,
		};
	}

	if (value instanceof Error) {
		return {
			code: "UNKNOWN",
			message: value.message,
		};
	}

	return {
		code: "UNKNOWN",
		message: "Failed to initialise the verification session.",
	};
}

function getWebDeviceId(): string {
	if (typeof window === "undefined") {
		return `web-${crypto.randomUUID()}`;
	}

	try {
		const existing = window.localStorage.getItem(WEB_DEVICE_ID_STORAGE_KEY);
		if (existing) {
			return existing;
		}

		const generated = `web-${crypto.randomUUID()}`;
		window.localStorage.setItem(WEB_DEVICE_ID_STORAGE_KEY, generated);
		return generated;
	} catch {
		return `web-${crypto.randomUUID()}`;
	}
}

function toHelloCredentials(payload: {
	attempt_id: string;
	mobile_write_token: string;
}): HelloCredentials {
	return {
		attemptId: payload.attempt_id,
		mobileWriteToken: payload.mobile_write_token,
		deviceId: getWebDeviceId(),
		appVersion: WEB_APP_VERSION,
	};
}

export function closeSessionStub(sessionStubRef: {
	current: VerifySession | null;
}) {
	if (!sessionStubRef.current) {
		return;
	}

	sessionStubRef.current.close();
	sessionStubRef.current = null;
}

export function reportCallbackErrorDevOnly(error: unknown): void {
	if (!import.meta.env.DEV) {
		return;
	}

	const callbackError =
		error instanceof Error ? error : new Error("session_error_callback_failed");

	queueMicrotask(() => {
		throw callbackError;
	});
}

export async function bootstrapSupportedSession({
	sessionId,
	handleRpcError,
	isUnmountedRef,
	sessionStubRef,
	setIsSessionReady,
	setError,
}: {
	sessionId: string;
	handleRpcError: (sessionError: SessionError) => void;
	isUnmountedRef: { current: boolean };
	sessionStubRef: { current: VerifySession | null };
	setIsSessionReady: (value: boolean) => void;
	setError: (value: SessionError | null) => void;
}) {
	try {
		const handoffPayload = await requestHandoffPayload(sessionId);
		if (isUnmountedRef.current) {
			return;
		}

		const stub = initialiseSession(
			{
				sessionId,
				helloCredentials: toHelloCredentials(handoffPayload),
			},
			handleRpcError,
		);
		sessionStubRef.current = stub;

		await stub.connect();
		const pingResult = await stub.ping();
		if (!pingResult) {
			throw new Error("Invalid ping response");
		}

		if (isUnmountedRef.current) {
			return;
		}

		setIsSessionReady(true);
		setError(null);
	} catch (bootstrapError) {
		if (isUnmountedRef.current) {
			return;
		}
		handleRpcError(toSessionError(bootstrapError));
	}
}

export function shouldStartInHandoff(
	sessionStatus: VerifySessionStatusPayload,
): boolean {
	return !(
		sessionStatus.status === "created" &&
		sessionStatus.latest_attempt === null &&
		!sessionStatus.same_device_only
	);
}
