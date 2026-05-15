import type { VerifyDataPayload } from "./data-payload";
import {
	isLivenessVideoDataKind,
	isNfcDataKind,
	processDataPayload,
} from "./data-payload";
import { resolveVerifyErrorMessage } from "./error-response";
import { isPhaseAtOrAfter } from "./phase-state";
import type { VerifySocketContext } from "./socket-context";

export function handleDataMessage(
	context: VerifySocketContext,
	payload: VerifyDataPayload,
): void {
	const { state, transport } = context;
	const kind = payload.kind ?? 0;

	transport.logDebug("recv_data", {
		kind,
		size: payload.raw?.length ?? 0,
		index: payload.index ?? 0,
		total: payload.total ?? 0,
		chunkIndex: payload.chunkIndex ?? 0,
		chunkTotal: payload.chunkTotal ?? 0,
	});

	// Allow NFC and liveness uploads at any phase from when the user starts
	// the corresponding step onward, not just the strict initiating phase. A
	// reconnect restores currentPhase from the DB (e.g., nfc_complete), and
	// the client must be able to re-stream lost in-memory artifacts before
	// the next phase advances. Strict equality here would reject the
	// restream and silently corrupt the attempt's validation state.
	if (
		isNfcDataKind(kind) &&
		!isPhaseAtOrAfter(state.currentPhase, "nfc_reading")
	) {
		transport.sendError(
			"NFC_DATA_PHASE_REQUIRED",
			resolveVerifyErrorMessage("NFC_DATA_PHASE_REQUIRED"),
		);
		return;
	}

	if (
		isLivenessVideoDataKind(kind) &&
		!isPhaseAtOrAfter(state.currentPhase, "liveness_capturing")
	) {
		transport.sendError(
			"LIVENESS_DATA_PHASE_REQUIRED",
			resolveVerifyErrorMessage("LIVENESS_DATA_PHASE_REQUIRED"),
		);
		return;
	}

	const result = processDataPayload({
		state: state.transfer,
		payload: {
			...payload,
			kind,
		},
	});

	if (result.error) {
		transport.sendError(result.error.code, result.error.message);
		return;
	}

	for (const ack of result.acks) {
		transport.sendAck(ack);
	}
}
