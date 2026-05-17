import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { ClientMessage, DataKind, ServerMessage } from "@kayle-id/capnp";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import {
	events,
	verification_attempts,
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { ERROR_MESSAGES } from "@kayle-id/translations/error-messages";
import { Message } from "capnp-es";
import { eq } from "drizzle-orm";
import type z from "zod";
import { createHMAC } from "@/functions/hmac";
import app from "@/index";
import type { Session } from "@/openapi/models/sessions";
import v1 from "@/v1";
import {
	createFaceScoreUnavailableLivenessVideo,
	createInvalidAuthenticityArtifacts,
	createMalformedDg2Artifact,
	createMatchingLivenessVideo,
	createMismatchLivenessVideo,
	createValidationPortraitJpeg,
	createValidNfcArtifacts,
} from "./helpers/verify-artifacts";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

type HandoffPayload = {
	v: number;
	session_id: string;
	attempt_id: string;
	mobile_write_token: string;
	expires_at: string;
};

type HandoffResponse = {
	data: HandoffPayload | null;
	error: {
		code: string;
		message: string;
	} | null;
};

type ServerAckOrError = {
	ack?: string;
	activeAuthChallenge?: {
		challenge: Uint8Array;
	};
	livenessChallenge?: {
		maxDurationMs: number;
		challengeNonce: Uint8Array;
	};
	error?: {
		code: string;
		message: string;
	};
	checkResult?: {
		outcome: "confirmed" | "not_confirmed";
		reasonCode: string;
		reasonMessage: string;
		retryAllowed: boolean;
		remainingAttempts: number;
	};
	shareRequest?: {
		contractVersion: number;
		sessionId: string;
		fields: Array<{
			key: string;
			reason: string;
			required: boolean;
		}>;
	};
	shareReady?: {
		sessionId: string;
		selectedFieldKeys: string[];
	};
};

const createdSessionIds: string[] = [];
const LONG_VERIFY_FLOW_TIMEOUT_MS = 20_000;
const VERIFY_TEST_SOCKET_BASE_URL =
	process.env.VERIFY_TEST_SOCKET_BASE_URL ?? "ws://127.0.0.1:8787";

function encodeHelloMessage({
	attemptId,
	mobileWriteToken,
	deviceId,
	appVersion,
}: {
	attemptId: string;
	mobileWriteToken: string;
	deviceId: string;
	appVersion: string;
}): Uint8Array {
	const message = new Message();
	const root = message.initRoot(ClientMessage);
	const hello = root._initHello();
	hello.attemptId = attemptId;
	hello.mobileWriteToken = mobileWriteToken;
	hello.deviceId = deviceId;
	hello.appVersion = appVersion;
	return new Uint8Array(message.toArrayBuffer());
}

function encodePhaseMessage(phase: string): Uint8Array {
	const message = new Message();
	const root = message.initRoot(ClientMessage);
	const phaseUpdate = root._initPhase();
	phaseUpdate.phase = phase;
	phaseUpdate.error = "";
	return new Uint8Array(message.toArrayBuffer());
}

function encodeDataMessage({
	kind,
	raw,
	index = 0,
	total = 1,
	chunkIndex = 0,
	chunkTotal = 1,
}: {
	kind: DataKind;
	raw: Uint8Array;
	index?: number;
	total?: number;
	chunkIndex?: number;
	chunkTotal?: number;
}): Uint8Array {
	const message = new Message();
	const root = message.initRoot(ClientMessage);
	const payload = root._initData();
	payload.kind = kind;
	payload._initRaw(raw.length).copyBuffer(raw);
	payload.index = index;
	payload.total = total;
	payload.chunkIndex = chunkIndex;
	payload.chunkTotal = chunkTotal;
	return new Uint8Array(message.toArrayBuffer());
}

function encodeShareSelectionMessage({
	selectedFieldKeys,
	sessionId,
}: {
	sessionId: string;
	selectedFieldKeys: string[];
}): Uint8Array {
	const message = new Message();
	const root = message.initRoot(ClientMessage);
	const selection = root._initShareSelection();
	selection.sessionId = sessionId;
	const keys = selection._initSelectedFieldKeys(selectedFieldKeys.length);

	for (const [index, key] of selectedFieldKeys.entries()) {
		keys.set(index, key);
	}

	return new Uint8Array(message.toArrayBuffer());
}

async function getEventBytes(data: unknown): Promise<Uint8Array | null> {
	if (typeof data === "string") {
		return null;
	}

	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}

	if (ArrayBuffer.isView(data)) {
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	}

	if (data instanceof Blob) {
		return new Uint8Array(await data.arrayBuffer());
	}

	return null;
}

function decodeServerMessage(bytes: Uint8Array): ServerAckOrError | null {
	try {
		const message = new Message(bytes, false);
		const root = message.getRoot(ServerMessage);

		switch (root.which()) {
			case ServerMessage.ACK:
				return {
					ack: root.ack.message,
				};

			case ServerMessage.ERROR:
				return {
					error: {
						code: root.error.code,
						message: root.error.message,
					},
				};
			case ServerMessage.CHECK_RESULT:
				return {
					checkResult: {
						outcome:
							root.checkResult.outcome === 0 ? "confirmed" : "not_confirmed",
						reasonCode: root.checkResult.reasonCode,
						reasonMessage: root.checkResult.reasonMessage,
						retryAllowed: root.checkResult.retryAllowed,
						remainingAttempts: root.checkResult.remainingAttempts,
					},
				};
			case ServerMessage.SHARE_REQUEST: {
				const fields = root.shareRequest.fields;
				const decodedFields: NonNullable<
					ServerAckOrError["shareRequest"]
				>["fields"] = [];

				for (let index = 0; index < fields.length; index += 1) {
					const field = fields.get(index);
					decodedFields.push({
						key: field.key,
						reason: field.reason,
						required: field.required,
					});
				}

				return {
					shareRequest: {
						contractVersion: root.shareRequest.contractVersion,
						sessionId: root.shareRequest.sessionId,
						fields: decodedFields,
					},
				};
			}
			case ServerMessage.SHARE_READY: {
				const selectedFieldKeys = root.shareReady.selectedFieldKeys;
				const decodedKeys: string[] = [];

				for (let index = 0; index < selectedFieldKeys.length; index += 1) {
					decodedKeys.push(selectedFieldKeys.get(index));
				}

				return {
					shareReady: {
						sessionId: root.shareReady.sessionId,
						selectedFieldKeys: decodedKeys,
					},
				};
			}
			case ServerMessage.ACTIVE_AUTH_CHALLENGE:
				return {
					activeAuthChallenge: {
						challenge: new Uint8Array(
							root.activeAuthChallenge.challenge.toUint8Array(),
						),
					},
				};

			case ServerMessage.LIVENESS_CHALLENGE:
				return {
					livenessChallenge: {
						maxDurationMs: root.livenessChallenge.maxDurationMs,
						challengeNonce: new Uint8Array(
							root.livenessChallenge.challengeNonce.toUint8Array(),
						),
					},
				};

			default:
				return null;
		}
	} catch {
		return null;
	}
}

type ServerMessageWaiter = {
	reject: (error: Error) => void;
	resolve: (message: ServerAckOrError) => void;
	timeout: ReturnType<typeof setTimeout>;
};

const serverMessageQueues = new WeakMap<WebSocket, ServerAckOrError[]>();
const serverMessageWaiters = new WeakMap<WebSocket, ServerMessageWaiter[]>();
const serverMessagePumps = new WeakSet<WebSocket>();

function resolveQueuedServerMessage(
	socket: WebSocket,
	message: ServerAckOrError,
): void {
	const waiters = serverMessageWaiters.get(socket);
	const waiter = waiters?.shift();

	if (waiter) {
		clearTimeout(waiter.timeout);
		waiter.resolve(message);
		return;
	}

	const queue = serverMessageQueues.get(socket) ?? [];
	queue.push(message);
	serverMessageQueues.set(socket, queue);
}

function rejectQueuedServerMessageWaiters(
	socket: WebSocket,
	error: Error,
): void {
	const waiters = serverMessageWaiters.get(socket) ?? [];
	serverMessageWaiters.set(socket, []);

	for (const waiter of waiters) {
		clearTimeout(waiter.timeout);
		waiter.reject(error);
	}
}

function removeServerMessageWaiter(
	socket: WebSocket,
	waiter: ServerMessageWaiter,
): void {
	const waiters = serverMessageWaiters.get(socket);

	if (!waiters) {
		return;
	}

	const index = waiters.indexOf(waiter);
	if (index !== -1) {
		waiters.splice(index, 1);
	}
}

function ensureServerMessagePump(socket: WebSocket): void {
	if (serverMessagePumps.has(socket)) {
		return;
	}

	serverMessagePumps.add(socket);
	serverMessageQueues.set(socket, []);
	serverMessageWaiters.set(socket, []);

	socket.addEventListener("message", async (event: MessageEvent) => {
		const bytes = await getEventBytes(event.data);
		if (!bytes) {
			rejectQueuedServerMessageWaiters(
				socket,
				new Error("Expected a binary server message."),
			);
			return;
		}

		const decoded = decodeServerMessage(bytes);
		if (!decoded) {
			rejectQueuedServerMessageWaiters(
				socket,
				new Error("Failed to decode server protobuf message."),
			);
			return;
		}

		// The server emits an activeAuthChallenge after every successful hello
		// as part of the AA protocol. Tests that don't exercise AA expect the
		// next ack/checkResult directly, so skip the challenge and keep listening.
		if (decoded.activeAuthChallenge !== undefined) {
			return;
		}

		// Same pass-through for the liveness challenge emitted on the
		// nfc_complete -> liveness_capturing transition; tests await the
		// trailing phase_ok ack, not the challenge itself.
		if (decoded.livenessChallenge !== undefined) {
			return;
		}

		resolveQueuedServerMessage(socket, decoded);
	});

	socket.addEventListener("error", () => {
		rejectQueuedServerMessageWaiters(
			socket,
			new Error("WebSocket connection failed."),
		);
	});

	socket.addEventListener("close", () => {
		rejectQueuedServerMessageWaiters(
			socket,
			new Error("WebSocket closed before receiving a server message."),
		);
	});
}

function awaitSocketOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		if (socket.readyState === WebSocket.OPEN) {
			resolve();
			return;
		}

		if (
			socket.readyState === WebSocket.CLOSING ||
			socket.readyState === WebSocket.CLOSED
		) {
			reject(new Error("WebSocket closed before opening."));
			return;
		}

		const handleOpen = () => {
			cleanup();
			resolve();
		};

		const handleError = () => {
			cleanup();
			reject(new Error("WebSocket connection failed."));
		};

		const handleClose = () => {
			cleanup();
			reject(new Error("WebSocket closed before opening."));
		};

		const cleanup = () => {
			socket.removeEventListener("open", handleOpen);
			socket.removeEventListener("error", handleError);
			socket.removeEventListener("close", handleClose);
		};

		socket.addEventListener("open", handleOpen);
		socket.addEventListener("error", handleError);
		socket.addEventListener("close", handleClose);
	});
}

function awaitServerMessage(socket: WebSocket): Promise<ServerAckOrError> {
	ensureServerMessagePump(socket);

	const queue = serverMessageQueues.get(socket);
	const queuedMessage = queue?.shift();
	if (queuedMessage) {
		return Promise.resolve(queuedMessage);
	}

	return new Promise((resolve, reject) => {
		const timeoutMs = 15_000;

		let waiter: ServerMessageWaiter;
		waiter = {
			resolve,
			reject,
			timeout: setTimeout(() => {
				removeServerMessageWaiter(socket, waiter);
				reject(new Error("Timed out waiting for server message."));
			}, timeoutMs),
		};

		const waiters = serverMessageWaiters.get(socket) ?? [];
		waiters.push(waiter);
		serverMessageWaiters.set(socket, waiters);
	});
}

function openVerifySocket(sessionId: string): WebSocket {
	const socket = new WebSocket(
		`${VERIFY_TEST_SOCKET_BASE_URL}/v1/verify/session/${sessionId}`,
	);
	socket.binaryType = "arraybuffer";
	ensureServerMessagePump(socket);
	return socket;
}

function awaitSocketClose(socket: WebSocket): Promise<CloseEvent> {
	return new Promise((resolve) => {
		if (socket.readyState === WebSocket.CLOSED) {
			resolve({ code: 1000 } as CloseEvent);
			return;
		}

		socket.addEventListener(
			"close",
			(event) => {
				resolve(event);
			},
			{ once: true },
		);
	});
}

function awaitServerMessageOrClose(socket: WebSocket): Promise<
	| {
			kind: "message";
			message: ServerAckOrError;
	  }
	| {
			kind: "close";
			event: CloseEvent;
	  }
> {
	return new Promise((resolve, reject) => {
		const timeoutMs = 15_000;

		const timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for server message or close."));
		}, timeoutMs);

		const handleMessage = async (event: MessageEvent) => {
			const bytes = await getEventBytes(event.data);

			if (!bytes) {
				cleanup();
				reject(new Error("Expected a binary server message."));
				return;
			}

			const decoded = decodeServerMessage(bytes);
			if (!decoded) {
				cleanup();
				reject(new Error("Failed to decode server protobuf message."));
				return;
			}

			if (decoded.activeAuthChallenge !== undefined) {
				return;
			}

			if (decoded.livenessChallenge !== undefined) {
				return;
			}

			cleanup();
			resolve({
				kind: "message",
				message: decoded,
			});
		};

		const handleError = () => {
			cleanup();
			reject(new Error("WebSocket connection failed."));
		};

		const handleClose = (event: CloseEvent) => {
			cleanup();
			resolve({
				kind: "close",
				event,
			});
		};

		const cleanup = () => {
			clearTimeout(timeout);
			socket.removeEventListener("message", handleMessage);
			socket.removeEventListener("error", handleError);
			socket.removeEventListener("close", handleClose);
		};

		socket.addEventListener("message", handleMessage);
		socket.addEventListener("error", handleError);
		socket.addEventListener("close", handleClose);
	});
}

async function createSession(body?: {
	share_fields?: Record<string, { required: boolean; reason: string }>;
}): Promise<string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${TEST_DATA?.apiKey}`,
	};

	const requestInit: RequestInit = {
		method: "POST",
		headers,
	};

	if (body) {
		headers["Content-Type"] = "application/json";
		requestInit.body = JSON.stringify(body);
	}

	const response = await v1.request("/sessions", requestInit);

	if (response.status !== 200) {
		throw new Error(`Expected 200 from /sessions, received ${response.status}`);
	}

	const { data } = (await response.json()) as {
		data: z.infer<typeof Session>;
	};

	if (!data?.id) {
		throw new Error("Failed to create session");
	}

	createdSessionIds.push(data.id);

	return data.id;
}

async function createHandoff(sessionId: string): Promise<HandoffPayload> {
	const consentResponse = await app.request(
		`/v1/verify/session/${sessionId}/consent`,
		{
			body: JSON.stringify({
				biometric_consent: true,
				document_processing_consent: true,
				privacy_notice_acknowledged: true,
				share_claims_consent: true,
				terms_acknowledged: true,
			}),
			headers: {
				"Content-Type": "application/json",
			},
			method: "POST",
		},
	);

	if (consentResponse.status !== 200) {
		throw new Error(
			`Expected 200 from /v1/verify/session/:id/consent, received ${consentResponse.status}`,
		);
	}

	const response = await app.request(
		`/v1/verify/session/${sessionId}/handoff`,
		{
			method: "POST",
		},
	);

	if (response.status !== 200) {
		throw new Error(
			`Expected 200 from /v1/verify/session/:id/handoff, received ${response.status}`,
		);
	}

	const payload = (await response.json()) as HandoffResponse;

	if (!payload.data) {
		throw new Error("Expected handoff response data");
	}

	return payload.data;
}

async function assertAckMessage({
	socket,
	expected,
}: {
	socket: WebSocket;
	expected: string;
}): Promise<void> {
	const response = await awaitServerMessage(socket);
	if (response.ack !== expected) {
		throw new Error(
			`Expected ack "${expected}", received "${response.ack ?? response.error?.code ?? "none"}".`,
		);
	}
}

async function sendNfcArtifacts({
	socket,
	artifacts,
}: {
	socket: WebSocket;
	artifacts: {
		dg1: Uint8Array;
		dg2: Uint8Array;
		sod: Uint8Array;
	};
}): Promise<void> {
	socket.send(
		encodeDataMessage({
			kind: DataKind.DG1,
			raw: artifacts.dg1,
		}),
	);
	await assertAckMessage({
		socket,
		expected: "data_ok_0_0",
	});

	socket.send(
		encodeDataMessage({
			kind: DataKind.DG2,
			raw: artifacts.dg2,
		}),
	);
	await assertAckMessage({
		socket,
		expected: "data_ok_1_0",
	});

	socket.send(
		encodeDataMessage({
			kind: DataKind.SOD,
			raw: artifacts.sod,
		}),
	);
	await assertAckMessage({
		socket,
		expected: "data_ok_2_0",
	});
}

async function sendLivenessVideo({
	socket,
	video,
}: {
	socket: WebSocket;
	video: Uint8Array;
}): Promise<void> {
	socket.send(
		encodeDataMessage({
			kind: DataKind.LIVENESS_VIDEO,
			raw: video,
			index: 0,
			total: 1,
		}),
	);
	await assertAckMessage({
		socket,
		expected: "data_ok_8_0",
	});
}

async function advanceToShareRequest({
	sessionId,
	shareFields,
}: {
	sessionId?: string;
	shareFields?: Record<string, { reason: string; required: boolean }>;
}) {
	const resolvedSessionId =
		sessionId ??
		(await createSession(
			shareFields
				? {
						share_fields: shareFields,
					}
				: undefined,
		));
	const handoff = await createHandoff(resolvedSessionId);
	const artifacts = await createValidNfcArtifacts();
	const matchingVideo = createMatchingLivenessVideo();
	const socket = openVerifySocket(resolvedSessionId);

	await awaitSocketOpen(socket);
	socket.send(
		encodeHelloMessage({
			attemptId: handoff.attempt_id,
			mobileWriteToken: handoff.mobile_write_token,
			deviceId: "ios-device-a",
			appVersion: "1.0.0",
		}),
	);
	if ((await awaitServerMessage(socket)).ack !== "hello_ok") {
		throw new Error("Expected hello_ok during share-request setup.");
	}

	socket.send(encodePhaseMessage("mrz_scanning"));
	if ((await awaitServerMessage(socket)).ack !== "phase_ok") {
		throw new Error("Expected phase_ok for mrz_scanning during setup.");
	}

	socket.send(encodePhaseMessage("mrz_complete"));
	if ((await awaitServerMessage(socket)).ack !== "phase_ok") {
		throw new Error("Expected phase_ok for mrz_complete during setup.");
	}

	socket.send(encodePhaseMessage("nfc_reading"));
	if ((await awaitServerMessage(socket)).ack !== "phase_ok") {
		throw new Error("Expected phase_ok for nfc_reading during setup.");
	}

	await sendNfcArtifacts({
		socket,
		artifacts,
	});

	socket.send(encodePhaseMessage("nfc_complete"));
	if ((await awaitServerMessage(socket)).ack !== "phase_ok") {
		throw new Error("Expected phase_ok for nfc_complete during setup.");
	}

	socket.send(encodePhaseMessage("liveness_capturing"));
	if ((await awaitServerMessage(socket)).ack !== "phase_ok") {
		throw new Error("Expected phase_ok for liveness_capturing during setup.");
	}

	await sendLivenessVideo({
		socket,
		video: matchingVideo,
	});

	socket.send(encodePhaseMessage("liveness_complete"));
	const checkResult = (await awaitServerMessage(socket)).checkResult;
	if (
		!(
			checkResult?.outcome === "confirmed" &&
			checkResult.reasonCode === "" &&
			checkResult.reasonMessage === "" &&
			checkResult.retryAllowed === false &&
			checkResult.remainingAttempts === 0
		)
	) {
		throw new Error(
			"Expected confirmed checkResult during share-request setup.",
		);
	}

	const shareRequest = (await awaitServerMessage(socket)).shareRequest;
	if (!shareRequest) {
		throw new Error("Expected shareRequest during setup.");
	}

	return {
		artifacts,
		handoff,
		sessionId: resolvedSessionId,
		shareRequest,
		socket,
	};
}

async function sendHello({
	socket,
	handoff,
	deviceId = "ios-device-a",
}: {
	socket: WebSocket;
	handoff: HandoffPayload;
	deviceId?: string;
}): Promise<void> {
	socket.send(
		encodeHelloMessage({
			attemptId: handoff.attempt_id,
			mobileWriteToken: handoff.mobile_write_token,
			deviceId,
			appVersion: "1.0.0",
		}),
	);
	await assertAckMessage({
		socket,
		expected: "hello_ok",
	});
}

async function advanceToNfcReading(socket: WebSocket): Promise<void> {
	socket.send(encodePhaseMessage("mrz_scanning"));
	await assertAckMessage({
		socket,
		expected: "phase_ok",
	});

	socket.send(encodePhaseMessage("mrz_complete"));
	await assertAckMessage({
		socket,
		expected: "phase_ok",
	});

	socket.send(encodePhaseMessage("nfc_reading"));
	await assertAckMessage({
		socket,
		expected: "phase_ok",
	});
}

async function advanceToLivenessCapturing({
	socket,
	artifacts,
}: {
	socket: WebSocket;
	artifacts: {
		dg1: Uint8Array;
		dg2: Uint8Array;
		sod: Uint8Array;
	};
}): Promise<void> {
	await advanceToNfcReading(socket);
	await sendNfcArtifacts({
		socket,
		artifacts,
	});

	socket.send(encodePhaseMessage("nfc_complete"));
	await assertAckMessage({
		socket,
		expected: "phase_ok",
	});

	socket.send(encodePhaseMessage("liveness_capturing"));
	await assertAckMessage({
		socket,
		expected: "phase_ok",
	});
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	for (const sessionId of createdSessionIds) {
		await v1.request(`/sessions/${sessionId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			},
		});
	}

	await teardown();
});

describe("Verification Flows", () => {
	test.serial(
		"Accepts authenticated hello and persists consume + session ownership",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);

				const response = await awaitServerMessage(socket);
				expect(response.ack).toBe("hello_ok");
			} finally {
				socket.close();
			}

			const [session] = await db
				.select({
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			const [attempt] = await db
				.select({
					mobileWriteTokenConsumedAt:
						verification_attempts.mobileWriteTokenConsumedAt,
					mobileHelloDeviceIdHash:
						verification_attempts.mobileHelloDeviceIdHash,
					mobileHelloAppVersion: verification_attempts.mobileHelloAppVersion,
					currentPhase: verification_attempts.currentPhase,
					phaseUpdatedAt: verification_attempts.phaseUpdatedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			expect(session?.status).toBe("in_progress");
			expect(attempt?.mobileWriteTokenConsumedAt).not.toBeNull();
			const expectedDeviceHash = await createHMAC("ios-device-a", {
				secret: env.AUTH_SECRET,
			});
			expect(attempt?.mobileHelloDeviceIdHash).toBe(expectedDeviceHash);
			expect(attempt?.mobileHelloAppVersion).toBe("1.0.0");
			expect(attempt?.currentPhase).toBe("mobile_connected");
			expect(attempt?.phaseUpdatedAt).not.toBeNull();
		},
	);

	test.serial("Rejects hello missing required credentials", async () => {
		const sessionId = await createSession();
		await createHandoff(sessionId);

		const socket = openVerifySocket(sessionId);

		try {
			await awaitSocketOpen(socket);
			socket.send(
				encodeHelloMessage({
					attemptId: "",
					mobileWriteToken: "",
					deviceId: "ios-device-a",
					appVersion: "1.0.0",
				}),
			);

			const response = await awaitServerMessage(socket);
			expect(response.error?.code).toBe("HELLO_AUTH_REQUIRED");
		} finally {
			socket.close();
		}
	});

	test.serial(
		"Returns ATTEMPT_NOT_FOUND for unknown attempt in hello",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: "va_unknown_attempt_id",
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);

				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("ATTEMPT_NOT_FOUND");
			} finally {
				socket.close();
			}
		},
	);

	test.serial("Rejects hello with invalid token hash", async () => {
		const sessionId = await createSession();
		const handoff = await createHandoff(sessionId);

		const socket = openVerifySocket(sessionId);

		try {
			await awaitSocketOpen(socket);
			socket.send(
				encodeHelloMessage({
					attemptId: handoff.attempt_id,
					mobileWriteToken: "invalid-token",
					deviceId: "ios-device-a",
					appVersion: "1.0.0",
				}),
			);

			const response = await awaitServerMessage(socket);
			expect(response.error?.code).toBe("HANDOFF_TOKEN_INVALID");
		} finally {
			socket.close();
		}
	});

	test.serial(
		"Rejects hello when token is expired and unconsumed",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			await db
				.update(verification_attempts)
				.set({
					mobileWriteTokenExpiresAt: new Date(Date.now() - 1000),
					mobileWriteTokenConsumedAt: null,
				})
				.where(eq(verification_attempts.id, handoff.attempt_id));

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);

				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("HANDOFF_TOKEN_EXPIRED");
			} finally {
				socket.close();
			}
		},
	);

	test.serial("Allows consumed-token resume from the same device", async () => {
		const sessionId = await createSession();
		const handoff = await createHandoff(sessionId);
		const helloMessage = encodeHelloMessage({
			attemptId: handoff.attempt_id,
			mobileWriteToken: handoff.mobile_write_token,
			deviceId: "ios-device-a",
			appVersion: "1.0.0",
		});

		const socketOne = openVerifySocket(sessionId);

		try {
			await awaitSocketOpen(socketOne);
			socketOne.send(helloMessage);
			const firstResponse = await awaitServerMessage(socketOne);
			expect(firstResponse.ack).toBe("hello_ok");
		} finally {
			socketOne.close();
		}

		const socketTwo = openVerifySocket(sessionId);

		try {
			await awaitSocketOpen(socketTwo);
			socketTwo.send(helloMessage);
			const secondResponse = await awaitServerMessage(socketTwo);
			expect(secondResponse.ack).toBe("hello_ok");
		} finally {
			socketTwo.close();
		}
	});

	test.serial(
		"Allows same-device reconnect to take over an active claim",
		async () => {
			// iOS calls reconnectForTransfer() right after the NFC scan, which
			// disconnects + reconnects faster than the old socket's release can
			// flush. The new socket's hello must succeed because it has already
			// proven device identity via the resume auth path.
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const helloMessage = encodeHelloMessage({
				attemptId: handoff.attempt_id,
				mobileWriteToken: handoff.mobile_write_token,
				deviceId: "ios-device-a",
				appVersion: "1.0.0",
			});

			const socketOne = openVerifySocket(sessionId);
			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(helloMessage);
				const firstResponse = await awaitServerMessage(socketOne);
				expect(firstResponse.ack).toBe("hello_ok");

				await awaitSocketOpen(socketTwo);
				socketTwo.send(helloMessage);
				const secondResponse = await awaitServerMessage(socketTwo);
				expect(secondResponse.ack).toBe("hello_ok");
			} finally {
				socketOne.close();
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Rejects a different device that races a fresh consume hello",
		async () => {
			// Two devices grab the same QR and race the consume hello. Only one
			// can win the claim; the other gets ATTEMPT_CONNECTION_ACTIVE
			// because the resume path is gated on matching deviceIdHash.
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socketOne = openVerifySocket(sessionId);
			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				const firstResponse = await awaitServerMessage(socketOne);
				expect(firstResponse.ack).toBe("hello_ok");

				await awaitSocketOpen(socketTwo);
				socketTwo.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-b",
						appVersion: "1.0.0",
					}),
				);
				const secondResponse = await awaitServerMessage(socketTwo);
				expect(secondResponse.error?.code).toBe("HANDOFF_DEVICE_MISMATCH");
			} finally {
				socketOne.close();
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Accepts ordered MRZ phase transitions and persists phase state",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				const helloResponse = await awaitServerMessage(socket);
				expect(helloResponse.ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mobile_connected"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					currentPhase: verification_attempts.currentPhase,
					phaseUpdatedAt: verification_attempts.phaseUpdatedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			expect(attempt?.currentPhase).toBe("mrz_complete");
			expect(attempt?.phaseUpdatedAt).not.toBeNull();
		},
	);

	test.serial("Rejects out-of-order tracked phase transitions", async () => {
		const sessionId = await createSession();
		const handoff = await createHandoff(sessionId);

		const socket = openVerifySocket(sessionId);

		try {
			await awaitSocketOpen(socket);
			socket.send(
				encodeHelloMessage({
					attemptId: handoff.attempt_id,
					mobileWriteToken: handoff.mobile_write_token,
					deviceId: "ios-device-a",
					appVersion: "1.0.0",
				}),
			);
			const helloResponse = await awaitServerMessage(socket);
			expect(helloResponse.ack).toBe("hello_ok");

			socket.send(encodePhaseMessage("mrz_complete"));
			const response = await awaitServerMessage(socket);
			expect(response.error?.code).toBe("PHASE_OUT_OF_ORDER");
		} finally {
			socket.close();
		}
	});

	test.serial(
		"Accepts duplicate tracked phase updates idempotently",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				const helloResponse = await awaitServerMessage(socket);
				expect(helloResponse.ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mobile_connected"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mobile_connected"));
				const duplicateResponse = await awaitServerMessage(socket);
				expect(duplicateResponse.ack).toBe("phase_ok");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Rejects consumed-token resume from a different device",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socketOne = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				const firstResponse = await awaitServerMessage(socketOne);
				expect(firstResponse.ack).toBe("hello_ok");
			} finally {
				socketOne.close();
			}

			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketTwo);
				socketTwo.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-b",
						appVersion: "1.0.0",
					}),
				);

				const secondResponse = await awaitServerMessage(socketTwo);
				expect(secondResponse.error?.code).toBe("HANDOFF_DEVICE_MISMATCH");
			} finally {
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Handoff endpoint blocks new handoff issuance after authenticated hello",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				const response = await awaitServerMessage(socket);
				expect(response.ack).toBe("hello_ok");
			} finally {
				socket.close();
			}

			const secondHandoffResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);

			expect(secondHandoffResponse.status).toBe(409);
			const payload = (await secondHandoffResponse.json()) as HandoffResponse;
			expect(payload.error?.code).toBe("SESSION_IN_PROGRESS");
		},
	);

	test.serial(
		"Rejects NFC DG data before nfc_reading with NFC_DATA_PHASE_REQUIRED",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(
					encodeDataMessage({
						kind: DataKind.DG1,
						raw: new Uint8Array([1, 2, 3]),
					}),
				);

				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("NFC_DATA_PHASE_REQUIRED");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Allows out-of-order DG2 chunk upload and emits data_ok on completion",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(
					encodeDataMessage({
						kind: DataKind.DG2,
						raw: new Uint8Array([2, 2]),
						index: 0,
						total: 1,
						chunkIndex: 1,
						chunkTotal: 2,
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe(
					"data_chunk_ok_1_0_1",
				);

				socket.send(
					encodeDataMessage({
						kind: DataKind.DG2,
						raw: new Uint8Array([1, 1]),
						index: 0,
						total: 1,
						chunkIndex: 0,
						chunkTotal: 2,
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("data_ok_1_0");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Rejects nfc_complete until DG1/DG2/SOD are fully received",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_complete"));
				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("NFC_REQUIRED_DATA_MISSING");
				const parsed = JSON.parse(response.error?.message ?? "{}") as {
					missing_artifacts?: string[];
				};
				expect(parsed.missing_artifacts).toEqual(["dg1", "dg2", "sod"]);
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Accepts nfc_complete after full DG1/DG2/SOD upload and persists phase",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					currentPhase: verification_attempts.currentPhase,
					phaseUpdatedAt: verification_attempts.phaseUpdatedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			expect(attempt?.currentPhase).toBe("nfc_complete");
			expect(attempt?.phaseUpdatedAt).not.toBeNull();
		},
	);

	test.serial(
		"Reconnect requires NFC data resend after disconnect",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const hello = encodeHelloMessage({
				attemptId: handoff.attempt_id,
				mobileWriteToken: handoff.mobile_write_token,
				deviceId: "ios-device-a",
				appVersion: "1.0.0",
			});

			const socketOne = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(hello);
				expect((await awaitServerMessage(socketOne)).ack).toBe("hello_ok");

				socketOne.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(
					encodeDataMessage({
						kind: DataKind.DG1,
						raw: new Uint8Array([9]),
					}),
				);
				expect((await awaitServerMessage(socketOne)).ack).toBe("data_ok_0_0");
			} finally {
				socketOne.close();
			}

			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketTwo);
				socketTwo.send(hello);
				expect((await awaitServerMessage(socketTwo)).ack).toBe("hello_ok");

				socketTwo.send(encodePhaseMessage("nfc_complete"));
				const response = await awaitServerMessage(socketTwo);

				expect(response.error?.code).toBe("NFC_REQUIRED_DATA_MISSING");
				const parsed = JSON.parse(response.error?.message ?? "{}") as {
					missing_artifacts?: string[];
				};
				expect(parsed.missing_artifacts).toEqual(["dg1", "dg2", "sod"]);
			} finally {
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Reconnect after nfc_complete accepts NFC restream and reaches checkResult",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();
			const matchingVideo = createMatchingLivenessVideo();
			const hello = encodeHelloMessage({
				attemptId: handoff.attempt_id,
				mobileWriteToken: handoff.mobile_write_token,
				deviceId: "ios-device-a",
				appVersion: "1.0.0",
			});

			const socketOne = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(hello);
				expect((await awaitServerMessage(socketOne)).ack).toBe("hello_ok");

				socketOne.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket: socketOne,
					artifacts,
				});

				socketOne.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");
			} finally {
				socketOne.close();
			}

			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketTwo);
				socketTwo.send(hello);
				expect((await awaitServerMessage(socketTwo)).ack).toBe("hello_ok");

				// The reconnect path: the per-socket VerifyTransferState is empty,
				// so the client must restream NFC artifacts even though the DB phase
				// is already nfc_complete. This is the gate that the strict
				// currentPhase === "nfc_reading" check used to block.
				await sendNfcArtifacts({
					socket: socketTwo,
					artifacts,
				});

				socketTwo.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socketTwo)).ack).toBe("phase_ok");

				await sendLivenessVideo({
					socket: socketTwo,
					video: matchingVideo,
				});

				socketTwo.send(encodePhaseMessage("liveness_complete"));
				const checkResult = (await awaitServerMessage(socketTwo)).checkResult;
				expect(checkResult?.outcome).toBe("confirmed");
			} finally {
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Reconnect that skips NFC restream surfaces NFC_REQUIRED_DATA_MISSING on liveness_complete",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();
			const matchingVideo = createMatchingLivenessVideo();
			const hello = encodeHelloMessage({
				attemptId: handoff.attempt_id,
				mobileWriteToken: handoff.mobile_write_token,
				deviceId: "ios-device-a",
				appVersion: "1.0.0",
			});

			const socketOne = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(hello);
				expect((await awaitServerMessage(socketOne)).ack).toBe("hello_ok");

				socketOne.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket: socketOne,
					artifacts,
				});

				socketOne.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");
			} finally {
				socketOne.close();
			}

			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketTwo);
				socketTwo.send(hello);
				expect((await awaitServerMessage(socketTwo)).ack).toBe("hello_ok");

				socketTwo.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socketTwo)).ack).toBe("phase_ok");

				await sendLivenessVideo({
					socket: socketTwo,
					video: matchingVideo,
				});

				socketTwo.send(encodePhaseMessage("liveness_complete"));
				const response = await awaitServerMessage(socketTwo);

				expect(response.error?.code).toBe("NFC_REQUIRED_DATA_MISSING");
				const parsed = JSON.parse(response.error?.message ?? "{}") as {
					missing_artifacts?: string[];
				};
				expect(parsed.missing_artifacts).toEqual(["dg1", "dg2", "sod"]);
			} finally {
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Rejects liveness data before liveness_capturing with LIVENESS_DATA_PHASE_REQUIRED",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(
					encodeDataMessage({
						kind: DataKind.LIVENESS_VIDEO,
						raw: new Uint8Array([1, 2, 3]),
						index: 0,
						total: 1,
					}),
				);

				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("LIVENESS_DATA_PHASE_REQUIRED");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Accepts ordered transition from nfc_complete to liveness_capturing",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Rejects liveness_complete when the video has not been uploaded",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("liveness_complete"));
				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("LIVENESS_REQUIRED_DATA_MISSING");
				const parsed = JSON.parse(response.error?.message ?? "{}") as {
					received_bytes?: number;
					missing_chunks?: unknown[];
				};
				expect(parsed.received_bytes).toBe(0);
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Allows out-of-order liveness chunk upload and emits data_ok on completion",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(
					encodeDataMessage({
						kind: DataKind.LIVENESS_VIDEO,
						raw: new Uint8Array([7]),
						index: 0,
						total: 1,
						chunkIndex: 1,
						chunkTotal: 2,
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe(
					"data_chunk_ok_8_0_1",
				);

				socket.send(
					encodeDataMessage({
						kind: DataKind.LIVENESS_VIDEO,
						raw: new Uint8Array([6]),
						index: 0,
						total: 1,
						chunkIndex: 0,
						chunkTotal: 2,
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("data_ok_8_0");
			} finally {
				socket.close();
			}
		},
	);

	test.serial(
		"Accepts liveness_complete, then delivers shareRequest and keeps the socket open",
		async () => {
			const sessionId = await createSession({
				share_fields: {
					nationality_code: {
						required: false,
						reason: "Nationality code is optional for this flow.",
					},
					kayle_document_id: {
						required: true,
						reason: "Document ID is required for delivery.",
					},
				},
			});
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();
			const matchingVideo = createMatchingLivenessVideo();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(
					encodeHelloMessage({
						attemptId: handoff.attempt_id,
						mobileWriteToken: handoff.mobile_write_token,
						deviceId: "ios-device-a",
						appVersion: "1.0.0",
					}),
				);
				expect((await awaitServerMessage(socket)).ack).toBe("hello_ok");

				socket.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				socket.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socket)).ack).toBe("phase_ok");

				await sendLivenessVideo({
					socket,
					video: matchingVideo,
				});

				socket.send(encodePhaseMessage("liveness_complete"));
				expect((await awaitServerMessage(socket)).checkResult).toEqual({
					outcome: "confirmed",
					reasonCode: "",
					reasonMessage: "",
					retryAllowed: false,
					remainingAttempts: 0,
				});

				expect((await awaitServerMessage(socket)).shareRequest).toEqual({
					contractVersion: 1,
					sessionId,
					fields: [
						{
							key: "kayle_document_id",
							reason: "Document ID is required for delivery.",
							required: true,
						},
						{
							key: "nationality_code",
							reason: "Nationality code is optional for this flow.",
							required: false,
						},
					],
				});
				expect(socket.readyState).toBe(WebSocket.OPEN);
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					currentPhase: verification_attempts.currentPhase,
					status: verification_attempts.status,
					phaseUpdatedAt: verification_attempts.phaseUpdatedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			const [session] = await db
				.select({
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(attempt?.currentPhase).toBe("liveness_complete");
			expect(attempt?.status).toBe("in_progress");
			expect(attempt?.phaseUpdatedAt).not.toBeNull();
			expect(session?.status).toBe("in_progress");
		},
		LONG_VERIFY_FLOW_TIMEOUT_MS,
	);

	test.serial(
		"Accepts a valid share selection and returns shareReady in canonical field order",
		async () => {
			const sessionId = await createSession({
				share_fields: {
					kayle_human_id: {
						required: false,
						reason: "Human ID is optional.",
					},
					nationality_code: {
						required: false,
						reason: "Nationality code is optional.",
					},
					kayle_document_id: {
						required: true,
						reason: "Document ID is required.",
					},
				},
			});

			const { socket } = await advanceToShareRequest({ sessionId });

			try {
				socket.send(
					encodeShareSelectionMessage({
						sessionId,
						selectedFieldKeys: ["kayle_human_id", "kayle_document_id"],
					}),
				);

				expect((await awaitServerMessage(socket)).shareReady).toEqual({
					sessionId,
					selectedFieldKeys: ["kayle_document_id", "kayle_human_id"],
				});
				expect(socket.readyState).toBe(WebSocket.OPEN);
			} finally {
				socket.close();
			}
		},
		LONG_VERIFY_FLOW_TIMEOUT_MS,
	);

	test.serial(
		"Keeps the socket open on invalid share selection and allows resubmission",
		async () => {
			const sessionId = await createSession({
				share_fields: {
					nationality_code: {
						required: false,
						reason: "Nationality code is optional.",
					},
					kayle_document_id: {
						required: true,
						reason: "Document ID is required.",
					},
				},
			});

			const { socket } = await advanceToShareRequest({ sessionId });

			try {
				socket.send(
					encodeShareSelectionMessage({
						sessionId,
						selectedFieldKeys: ["unknown_claim"],
					}),
				);

				expect((await awaitServerMessage(socket)).error).toEqual({
					code: "SHARE_SELECTION_INVALID_FIELD",
					message: ERROR_MESSAGES.SHARE_SELECTION_INVALID_FIELD.description,
				});
				expect(socket.readyState).toBe(WebSocket.OPEN);

				socket.send(
					encodeShareSelectionMessage({
						sessionId,
						selectedFieldKeys: ["kayle_document_id"],
					}),
				);

				expect((await awaitServerMessage(socket)).shareReady).toEqual({
					sessionId,
					selectedFieldKeys: ["kayle_document_id"],
				});
			} finally {
				socket.close();
			}
		},
		LONG_VERIFY_FLOW_TIMEOUT_MS,
	);

	test.serial(
		"Reconnect requires liveness video resend after disconnect",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts();
			const hello = encodeHelloMessage({
				attemptId: handoff.attempt_id,
				mobileWriteToken: handoff.mobile_write_token,
				deviceId: "ios-device-a",
				appVersion: "1.0.0",
			});

			const socketOne = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketOne);
				socketOne.send(hello);
				expect((await awaitServerMessage(socketOne)).ack).toBe("hello_ok");

				socketOne.send(encodePhaseMessage("mrz_scanning"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("mrz_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("nfc_reading"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				await sendNfcArtifacts({
					socket: socketOne,
					artifacts,
				});

				socketOne.send(encodePhaseMessage("nfc_complete"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				socketOne.send(encodePhaseMessage("liveness_capturing"));
				expect((await awaitServerMessage(socketOne)).ack).toBe("phase_ok");

				// Send a partial chunk (chunkIndex 0 of 2) so the upload state shows
				// `received_bytes > 0` on the first socket but the transfer is
				// incomplete — used to confirm the per-socket VerifyTransferState
				// resets on reconnect.
				socketOne.send(
					encodeDataMessage({
						kind: DataKind.LIVENESS_VIDEO,
						raw: new Uint8Array([9]),
						index: 0,
						total: 1,
						chunkIndex: 0,
						chunkTotal: 2,
					}),
				);
				expect((await awaitServerMessage(socketOne)).ack).toBe(
					"data_chunk_ok_8_0_0",
				);
			} finally {
				socketOne.close();
			}

			const socketTwo = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socketTwo);
				socketTwo.send(hello);
				expect((await awaitServerMessage(socketTwo)).ack).toBe("hello_ok");

				// Restream NFC first — buildMissingDataMessage on liveness_complete
				// checks NFC presence before liveness, so without this the server
				// would report NFC_REQUIRED_DATA_MISSING instead of the LIVENESS one
				// this test is trying to exercise.
				await sendNfcArtifacts({
					socket: socketTwo,
					artifacts,
				});

				socketTwo.send(encodePhaseMessage("liveness_complete"));
				const response = await awaitServerMessage(socketTwo);

				expect(response.error?.code).toBe("LIVENESS_REQUIRED_DATA_MISSING");
				const parsed = JSON.parse(response.error?.message ?? "{}") as {
					received_bytes?: number;
				};
				expect(parsed.received_bytes).toBe(0);
			} finally {
				socketTwo.close();
			}
		},
	);

	test.serial(
		"Rejects nfc_complete on authenticity failure and enables retry with new attempt",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createInvalidAuthenticityArtifacts();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				await sendHello({
					socket,
					handoff,
				});
				await advanceToNfcReading(socket);
				await sendNfcArtifacts({
					socket,
					artifacts,
				});

				socket.send(encodePhaseMessage("nfc_complete"));
				const response = await awaitServerMessage(socket);
				expect(response.error).toBeUndefined();
				expect(response.checkResult).toEqual({
					outcome: "not_confirmed",
					reasonCode: "document_authenticity_failed",
					reasonMessage:
						ERROR_MESSAGES.document_authenticity_failed.description,
					retryAllowed: true,
					remainingAttempts: 2,
				});
				const nextEvent = await awaitServerMessageOrClose(socket);
				expect(nextEvent.kind).toBe("close");
				if (nextEvent.kind === "close") {
					expect(nextEvent.event.code).toBe(1008);
				}
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					status: verification_attempts.status,
					failureCode: verification_attempts.failureCode,
					riskScore: verification_attempts.riskScore,
					selectedShareFieldKeys: verification_attempts.selectedShareFieldKeys,
					completedAt: verification_attempts.completedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			const [session] = await db
				.select({
					status: verification_sessions.status,
					completedAt: verification_sessions.completedAt,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(attempt?.status).toBe("failed");
			expect(attempt?.failureCode).toBe("document_authenticity_failed");
			expect(attempt?.riskScore).toBe(1);
			expect(attempt?.completedAt).not.toBeNull();
			expect(session?.status).toBe("created");
			expect(session?.completedAt).toBeNull();

			const retryHandoff = await createHandoff(sessionId);
			expect(retryHandoff.attempt_id).not.toBe(handoff.attempt_id);
		},
	);

	test.serial(
		"Rejects liveness_complete on face mismatch and keeps session retryable before limit",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts({
				dg2ImageData: await createValidationPortraitJpeg(),
			});
			const mismatchVideo = createMismatchLivenessVideo();

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				await sendHello({
					socket,
					handoff,
				});
				await advanceToLivenessCapturing({
					socket,
					artifacts,
				});
				await sendLivenessVideo({
					socket,
					video: mismatchVideo,
				});

				socket.send(encodePhaseMessage("liveness_complete"));
				const response = await awaitServerMessage(socket);
				expect(response.error).toBeUndefined();
				expect(response.checkResult).toEqual({
					outcome: "not_confirmed",
					reasonCode: "selfie_face_mismatch",
					reasonMessage: ERROR_MESSAGES.selfie_face_mismatch.description,
					retryAllowed: true,
					remainingAttempts: 2,
				});
				const closeEvent = await awaitSocketClose(socket);
				expect(closeEvent.code).toBe(1008);
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					status: verification_attempts.status,
					failureCode: verification_attempts.failureCode,
					riskScore: verification_attempts.riskScore,
					completedAt: verification_attempts.completedAt,
					selectedShareFieldKeys: verification_attempts.selectedShareFieldKeys,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			const [session] = await db
				.select({
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(attempt?.status).toBe("failed");
			expect(attempt?.failureCode).toBe("selfie_face_mismatch");
			expect(attempt?.completedAt).not.toBeNull();
			expect((attempt?.riskScore ?? 0) > 0).toBeTrue();
			expect(session?.status).toBe("created");
		},
		20_000,
	);

	test.serial(
		"Terminalizes session after third failed validation attempt and blocks handoff",
		async () => {
			const sessionId = await createSession();
			const artifacts = await createValidNfcArtifacts({
				dg2ImageData: await createValidationPortraitJpeg(),
			});
			const mismatchVideo = createMismatchLivenessVideo();

			for (let index = 0; index < 3; index += 1) {
				const handoff = await createHandoff(sessionId);
				const socket = openVerifySocket(sessionId);

				try {
					await awaitSocketOpen(socket);
					await sendHello({
						socket,
						handoff,
						deviceId: `ios-device-${index}`,
					});
					await advanceToLivenessCapturing({
						socket,
						artifacts,
					});
					await sendLivenessVideo({
						socket,
						video: mismatchVideo,
					});

					socket.send(encodePhaseMessage("liveness_complete"));
					const response = await awaitServerMessage(socket);
					expect(response.error).toBeUndefined();
					expect(response.checkResult?.reasonCode).toBe("selfie_face_mismatch");
					expect(response.checkResult?.retryAllowed).toBe(index < 2);
					expect(response.checkResult?.remainingAttempts).toBe(2 - index);
					await awaitSocketClose(socket);
				} finally {
					socket.close();
				}
			}

			const attempts = await db
				.select({
					status: verification_attempts.status,
					failureCode: verification_attempts.failureCode,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.verificationSessionId, sessionId));

			const failedAttempts = attempts.filter(
				(attempt) => attempt.status === "failed",
			);
			expect(failedAttempts).toHaveLength(3);
			expect(
				failedAttempts.every(
					(attempt) => attempt.failureCode === "selfie_face_mismatch",
				),
			).toBeTrue();

			const [session] = await db
				.select({
					status: verification_sessions.status,
					completedAt: verification_sessions.completedAt,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(session?.status).toBe("completed");
			expect(session?.completedAt).not.toBeNull();

			const handoffResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);

			expect(handoffResponse.status).toBe(410);
			const payload = (await handoffResponse.json()) as HandoffResponse;
			expect(payload.error?.code).toBe("SESSION_EXPIRED");
		},
		20_000,
	);

	test.serial(
		"Marks attempt succeeded and session completed with risk score after confirmed share selection",
		async () => {
			const sessionId = await createSession({
				share_fields: {
					kayle_document_id: {
						required: true,
						reason: "Document ID is required.",
					},
				},
			});
			const { handoff, socket } = await advanceToShareRequest({ sessionId });

			try {
				socket.send(
					encodeShareSelectionMessage({
						sessionId,
						selectedFieldKeys: ["kayle_document_id"],
					}),
				);

				expect((await awaitServerMessage(socket)).shareReady).toEqual({
					sessionId,
					selectedFieldKeys: ["kayle_document_id"],
				});
				expect(socket.readyState).toBe(WebSocket.OPEN);
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					status: verification_attempts.status,
					failureCode: verification_attempts.failureCode,
					riskScore: verification_attempts.riskScore,
					completedAt: verification_attempts.completedAt,
					selectedShareFieldKeys: verification_attempts.selectedShareFieldKeys,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			const [session] = await db
				.select({
					status: verification_sessions.status,
					completedAt: verification_sessions.completedAt,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(attempt?.status).toBe("succeeded");
			expect(attempt?.failureCode).toBeNull();
			expect(attempt?.completedAt).not.toBeNull();
			expect((attempt?.riskScore ?? 1) < 0.2).toBeTrue();
			expect(attempt?.selectedShareFieldKeys).toEqual(["kayle_document_id"]);
			expect(session?.status).toBe("completed");
			expect(session?.completedAt).not.toBeNull();

			const [consent] = await db
				.select({
					selectedClaimKeys: verification_consents.selectedClaimKeys,
					verificationAttemptId: verification_consents.verificationAttemptId,
				})
				.from(verification_consents)
				.where(
					eq(verification_consents.verificationAttemptId, handoff.attempt_id),
				)
				.limit(1);

			expect(consent?.selectedClaimKeys).toEqual(["kayle_document_id"]);
			expect(consent?.verificationAttemptId).toBe(handoff.attempt_id);

			const successEvents = await db
				.select({
					type: events.type,
				})
				.from(events)
				.where(eq(events.triggerId, handoff.attempt_id));

			expect(
				successEvents.some(
					(event) => event.type === "verification.attempt.succeeded",
				),
			).toBeTrue();
		},
		20_000,
	);

	test.serial(
		"Rejects liveness_complete when similarity cannot be computed",
		async () => {
			const sessionId = await createSession();
			const handoff = await createHandoff(sessionId);
			const artifacts = await createValidNfcArtifacts({
				dg2: createMalformedDg2Artifact(),
			});

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				await sendHello({
					socket,
					handoff,
				});
				await advanceToLivenessCapturing({
					socket,
					artifacts,
				});
				await sendLivenessVideo({
					socket,
					video: createFaceScoreUnavailableLivenessVideo(),
				});

				socket.send(encodePhaseMessage("liveness_complete"));
				const response = await awaitServerMessage(socket);
				expect(response.ack).toBeUndefined();
				expect(response.checkResult).toEqual({
					outcome: "not_confirmed",
					reasonCode: "selfie_face_mismatch",
					reasonMessage: ERROR_MESSAGES.selfie_face_mismatch.description,
					retryAllowed: true,
					remainingAttempts: 2,
				});
			} finally {
				socket.close();
			}

			const [attempt] = await db
				.select({
					status: verification_attempts.status,
					failureCode: verification_attempts.failureCode,
					riskScore: verification_attempts.riskScore,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, handoff.attempt_id))
				.limit(1);

			expect(attempt?.status).toBe("failed");
			expect(attempt?.failureCode).toBe("selfie_face_mismatch");
			expect(attempt?.riskScore).toBe(1);
		},
		20_000,
	);

	test.serial(
		"Rejects non-hello messages before hello with HELLO_REQUIRED",
		async () => {
			const sessionId = await createSession();
			await createHandoff(sessionId);

			const socket = openVerifySocket(sessionId);

			try {
				await awaitSocketOpen(socket);
				socket.send(encodePhaseMessage("mobile_connected"));

				const response = await awaitServerMessage(socket);
				expect(response.error?.code).toBe("HELLO_REQUIRED");
			} finally {
				socket.close();
			}
		},
		5000,
	);
});
