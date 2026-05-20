import type {
	HelloCredentials,
	SessionError,
	VerifySession,
} from "@/api/session-socket";
import { initialiseSession } from "@/api/session-socket";
import {
	isVerifyRequestError,
	requestHandoffPayload,
	type VerifySessionStatusPayload,
} from "@/api/verify-api";

const WEB_APP_VERSION = "verify-web";
let webDeviceId: string | null = null;

export function toSessionError(value: unknown): SessionError {
	if (isVerifyRequestError(value)) {
		return { code: value.code, message: value.message || value.code };
	}

	if (value instanceof Error) {
		return { code: "UNKNOWN", message: value.message };
	}

	return {
		code: "UNKNOWN",
		message: "Failed to initialise the verification session.",
	};
}

export function getWebDeviceId(): string {
	webDeviceId ??= `web-${crypto.randomUUID()}`;
	return webDeviceId;
}

function toHelloCredentials(payload: {
	session_id: string;
	mobile_write_token: string;
}): HelloCredentials {
	return {
		sessionId: payload.session_id,
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

type BootstrapArgs = {
	sessionId: string;
	handleRpcError: (sessionError: SessionError) => void;
	isUnmountedRef: { current: boolean };
	sessionStubRef: { current: VerifySession | null };
	setIsSessionReady: (value: boolean) => void;
	setError: (value: SessionError | null) => void;
};

export async function bootstrapSupportedSession({
	sessionId,
	handleRpcError,
	isUnmountedRef,
	sessionStubRef,
	setIsSessionReady,
	setError,
}: BootstrapArgs) {
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
