import {
	encodeServerAck,
	encodeServerActiveAuthChallenge,
	encodeServerCheckResult,
	encodeServerError,
	encodeServerLivenessChallenge,
	encodeServerShareReady,
	encodeServerShareRequest,
	type VerifyServerCheckResult,
	type VerifyServerLivenessChallenge,
	type VerifyShareRequest,
} from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import type { ApiRequestLogger } from "@/logging";
import { resolveVerifyErrorMessage } from "./error-response";
import type { VerifySocketTransport } from "./socket-context";

const WEBSOCKET_OPEN = 1;

// Swallow errors raised when the peer has already gone away. Sends and closes
// against a half-shut WebSocket throw synchronously inside Workers; if those
// happen on an async cleanup path (e.g. the `.catch` handler in
// socket-controller.ts) the throw escapes as an unhandled rejection, which the
// runtime escalates into "Worker code hung" and wedges subsequent requests.
const isConnectionGoneError = (error: unknown): boolean => {
	if (!(error instanceof Error)) {
		return false;
	}
	const message = error.message;
	return (
		message.includes("Network connection lost") ||
		message.includes("WebSocket is not in a state")
	);
};

export function createVerifySocketTransport({
	debug,
	log,
	server,
}: {
	debug: boolean;
	log: ApiRequestLogger;
	server: WebSocket;
}): VerifySocketTransport {
	const logDebug = (label: string, details?: Record<string, unknown>) => {
		if (!debug) {
			return;
		}

		logEvent(log, {
			details,
			event: `verify.ws.${label}`,
		});
	};

	const safeSend = (payload: ArrayBuffer | ArrayBufferView | string) => {
		if (server.readyState !== WEBSOCKET_OPEN) {
			return;
		}
		try {
			server.send(payload);
		} catch (error) {
			if (!isConnectionGoneError(error)) {
				throw error;
			}
		}
	};

	const sendAck = (message: string) => {
		logDebug("send_ack", { message });
		safeSend(encodeServerAck(message));
	};

	const sendActiveAuthChallenge = (challenge: Uint8Array) => {
		logDebug("send_active_auth_challenge", { byte_length: challenge.length });
		safeSend(encodeServerActiveAuthChallenge({ challenge }));
	};

	const sendLivenessChallenge = (challenge: VerifyServerLivenessChallenge) => {
		logDebug("send_liveness_challenge", {
			max_duration_ms: challenge.maxDurationMs,
			nonce_bytes: challenge.challengeNonce.length,
		});
		safeSend(encodeServerLivenessChallenge(challenge));
	};

	const sendError = (code: string, message: string) => {
		logDebug("send_error", { code, message });
		safeSend(encodeServerError(code, message));
	};

	const sendCheckResult = (checkResult: VerifyServerCheckResult) => {
		logDebug("send_check_result", checkResult);
		safeSend(encodeServerCheckResult(checkResult));
	};

	const sendShareRequest = (shareRequest: VerifyShareRequest) => {
		logDebug("send_share_request", {
			contractVersion: shareRequest.contractVersion,
			fieldCount: shareRequest.fields.length,
		});
		safeSend(encodeServerShareRequest(shareRequest));
	};

	const sendShareReady = ({
		selectedFieldKeys,
		sessionId,
	}: {
		selectedFieldKeys: string[];
		sessionId: string;
	}) => {
		logDebug("send_share_ready", {
			fieldCount: selectedFieldKeys.length,
			sessionId,
		});
		safeSend(
			encodeServerShareReady({
				sessionId,
				selectedFieldKeys,
			}),
		);
	};

	const closeSocket = (code: number, reason: string) => {
		try {
			server.close(code, reason);
		} catch (error) {
			if (!isConnectionGoneError(error)) {
				throw error;
			}
		}
	};

	return {
		closeAfterCheckResult: (code: string) => {
			setTimeout(() => {
				closeSocket(1008, code);
			}, 0);
		},
		closeSocket,
		logDebug,
		sendAck,
		sendActiveAuthChallenge,
		sendAuthErrorAndClose: (code) => {
			const message = resolveVerifyErrorMessage(code);
			logEvent(log, {
				details: {
					error_code: code,
					error_message: message,
				},
				event: `verify.ws.auth_error.${code}`,
				level: "warn",
			});
			sendError(code, message);
			closeSocket(1008, code);
		},
		sendError,
		sendLivenessChallenge,
		sendShareReady,
		sendShareRequest,
		sendCheckResult,
	};
}
