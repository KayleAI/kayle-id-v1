import { decodeClientMessage } from "@kayle-id/capnp/verify-codec";
import { logSafeError } from "@kayle-id/config/logging";
import type { Context } from "hono";
import {
	emitRequestLog,
	getRequestLogger,
	markRequestLogForManualEmit,
} from "@/logging";
import { waitUntilIfAvailable } from "@/utils/wait-until";
import { releaseAttemptConnection } from "./attempt-connection";
import { MAX_FRAME_BYTES, resetTransferState } from "./data-payload";
import type { ActiveVerifySessionContext } from "./session-context";
import {
	createVerifySocketState,
	type VerifySocketContext,
} from "./socket-context";
import { handleDataMessage } from "./socket-data";
import { handleHelloMessage } from "./socket-hello";
import { handlePhaseMessage } from "./socket-phase";
import { handleShareSelectionMessage } from "./socket-share";
import { createVerifySocketTransport } from "./socket-transport";
import { createWebSocketPairTuple } from "./utils";

const FRAME_TOO_LARGE_CODE = "FRAME_TOO_LARGE";
const FRAME_TOO_LARGE_MESSAGE =
	"Verify frame exceeds the maximum allowed size.";

class FrameTooLargeError extends Error {}

async function getBytesFromEvent(
	event: MessageEvent,
): Promise<Uint8Array | undefined> {
	if (typeof event.data === "string") {
		return;
	}
	if (event.data instanceof ArrayBuffer) {
		if (event.data.byteLength > MAX_FRAME_BYTES) {
			throw new FrameTooLargeError(FRAME_TOO_LARGE_MESSAGE);
		}
		return new Uint8Array(event.data);
	}
	if (event.data instanceof Uint8Array) {
		if (event.data.byteLength > MAX_FRAME_BYTES) {
			throw new FrameTooLargeError(FRAME_TOO_LARGE_MESSAGE);
		}
		return event.data;
	}
	if (event.data instanceof Blob) {
		if (event.data.size > MAX_FRAME_BYTES) {
			throw new FrameTooLargeError(FRAME_TOO_LARGE_MESSAGE);
		}
		return new Uint8Array(await event.data.arrayBuffer());
	}
	return;
}

export function startVerifySocketSession(
	c: Context<{ Bindings: CloudflareBindings }>,
	activeSession: ActiveVerifySessionContext,
): Response {
	const debug = shouldEnableVerifySocketDebug(c.req.query("debug") === "1");
	const connectionOwnerId = crypto.randomUUID();
	const log = getRequestLogger(c);
	const [client, server] = createWebSocketPairTuple();
	server.accept();
	markRequestLogForManualEmit(c);
	log.set({
		event: "verify.ws.opened",
		organization_id: activeSession.session.organizationId,
		session_id: activeSession.session.id,
		websocket_debug: debug,
	});

	const context: VerifySocketContext = {
		connectionOwnerId,
		env: c.env,
		log,
		scheduleTask: (task) =>
			waitUntilIfAvailable({
				createTask: () => task,
				getExecutionCtx: () => c.executionCtx,
			}),
		session: activeSession.session,
		shareRequestPayload: activeSession.shareRequestPayload,
		state: createVerifySocketState(),
		transport: createVerifySocketTransport({ debug, log, server }),
	};

	const handleDecodedMessage = async (
		decoded: NonNullable<ReturnType<typeof decodeClientMessage>>,
	) => {
		if (decoded.hello) {
			await handleHelloMessage(context, decoded.hello);
			return;
		}

		if (!context.state.helloReceived) {
			context.transport.sendError(
				"HELLO_REQUIRED",
				"Send hello before other messages.",
			);
			return;
		}

		if (decoded.phase) {
			await handlePhaseMessage(context, decoded.phase);
			return;
		}

		if (decoded.data) {
			handleDataMessage(context, decoded.data);
			return;
		}

		if (decoded.shareSelection) {
			await handleShareSelectionMessage(context, decoded.shareSelection);
		}
	};

	server.addEventListener("message", (event) => {
		getBytesFromEvent(event)
			.then((bytes) => {
				if (!bytes) {
					context.transport.logDebug("recv_invalid_message");
					context.transport.sendError(
						"INVALID_MESSAGE",
						"Binary protobuf messages are required.",
					);
					return null;
				}

				const decoded = decodeClientMessage(bytes);
				if (!decoded) {
					context.transport.logDebug("recv_decode_failed", {
						size: bytes.length,
					});
					context.transport.sendError(
						"DECODE_FAILED",
						"Failed to decode protobuf message.",
					);
					return null;
				}

				return handleDecodedMessage(decoded);
			})
			.catch((error) => {
				if (error instanceof FrameTooLargeError) {
					context.transport.sendError(
						FRAME_TOO_LARGE_CODE,
						FRAME_TOO_LARGE_MESSAGE,
					);
					context.transport.closeSocket(1009, FRAME_TOO_LARGE_CODE);
					return;
				}

				logSafeError(log, {
					code: "verify_ws_internal_error",
					error,
					event: "verify.ws.internal_error",
					message: "WebSocket message handling failed.",
					status: 500,
				});
				// Never forward raw error.message to the client — Drizzle and pg-pool
				// errors include the failing SQL + parameter values, which can leak
				// schema and internal identifiers, and the same string ends up in
				// our logs via `send_error` debug.
				context.transport.sendError(
					"INTERNAL_ERROR",
					"An internal server error occurred.",
				);
				context.transport.closeSocket(1011, "INTERNAL_ERROR");
			});
	});

	server.addEventListener("close", (event) => {
		log.set({
			socket_close_code: event.code,
			socket_closed: true,
		});

		if (log.getContext().event === "verify.ws.opened") {
			log.set({
				event: "verify.ws.closed",
			});
		}

		if (context.state.attemptId) {
			context.scheduleTask(
				releaseAttemptConnection({
					attemptId: context.state.attemptId,
					ownerId: connectionOwnerId,
				}),
			);
		}

		resetTransferState(context.state.transfer);
		emitRequestLog(c, 101);
	});

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}

export function shouldEnableVerifySocketDebug(requested: boolean): boolean {
	return requested && process.env.NODE_ENV !== "production";
}
