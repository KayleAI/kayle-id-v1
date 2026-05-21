import { assembleChunk } from "./data-payload-chunks";
import {
	getLivenessTransferStatus,
	getNfcTransferStatus,
} from "./data-payload-status";
import { isAuthenticityReady, storeData } from "./data-payload-storage";
import type {
	DataResult,
	VerifyDataPayload,
	VerifyTransferState,
} from "./data-payload-types";
import {
	createErrorResult,
	normalizeDataPayload,
	validateDataPayload,
} from "./data-payload-validation";

export {
	isLivenessVideoDataKind,
	isNfcDataKind,
	MAX_CHUNKS_PER_KEY,
	MAX_FRAME_BYTES,
	MAX_KIND_BYTES,
	MAX_TOTAL_TRANSFER_BYTES,
} from "./data-payload-kinds";
export {
	createTransferState,
	resetLivenessTransferState,
	resetNfcTransferState,
	resetTransferState,
} from "./data-payload-state";
export {
	getLivenessTransferStatus,
	getNfcTransferStatus,
} from "./data-payload-status";
export type {
	LivenessTransferStatus,
	MissingNfcChunk,
	MissingTransferChunk,
	NfcTransferStatus,
	VerifyChunkEntry,
	VerifyDataPayload,
	VerifyTransferState,
} from "./data-payload-types";

export function processDataPayload({
	state,
	payload,
}: {
	state: VerifyTransferState;
	payload: VerifyDataPayload;
}): DataResult {
	const normalizedPayload = normalizeDataPayload(payload);

	const validationResult = validateDataPayload({
		state,
		...normalizedPayload,
	});
	if (validationResult) {
		return validationResult;
	}

	const assembled = assembleChunk({
		state,
		key: normalizedPayload.chunkKey,
		chunkIndex: normalizedPayload.chunkIndex,
		chunkTotal: normalizedPayload.chunkTotal,
		chunk: normalizedPayload.raw,
	});

	if (!assembled.complete) {
		return {
			acks: [
				`data_chunk_ok_${normalizedPayload.kind}_${normalizedPayload.index}_${normalizedPayload.chunkIndex}`,
			],
			authenticityReady: false,
			nfcStatus: getNfcTransferStatus(state),
			livenessStatus: getLivenessTransferStatus(state),
		};
	}

	const stored = storeData({
		state,
		kind: normalizedPayload.kind,
		data: assembled.data ?? normalizedPayload.raw,
	});

	if (!stored.ok) {
		return createErrorResult({
			state,
			code: stored.code,
			message: stored.message,
		});
	}

	const ack = `data_ok_${normalizedPayload.kind}_${normalizedPayload.index}`;

	return {
		acks: [ack],
		authenticityReady: isAuthenticityReady(state),
		nfcStatus: getNfcTransferStatus(state),
		livenessStatus: getLivenessTransferStatus(state),
	};
}
