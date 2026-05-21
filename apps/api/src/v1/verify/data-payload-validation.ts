import {
	createChunkRetryMessage,
	isNonNegativeInteger,
} from "./data-payload-chunks";
import {
	isLegacySelfieDataKind,
	isLivenessVideoDataKind,
	isNfcDataKind,
	isSupportedDataKind,
	MAX_CHUNKS_PER_KEY,
	MAX_FRAME_BYTES,
	MAX_TOTAL_TRANSFER_BYTES,
} from "./data-payload-kinds";
import {
	getLivenessTransferStatus,
	getNfcTransferStatus,
} from "./data-payload-status";
import type {
	DataResult,
	VerifyDataPayload,
	VerifyTransferState,
} from "./data-payload-types";

export type NormalizedDataPayload = {
	kind: number;
	raw: Uint8Array;
	index: number;
	total: number;
	chunkIndex: number;
	chunkTotal: number;
	chunkKey: string;
};

export function normalizeDataPayload(
	payload: VerifyDataPayload,
): NormalizedDataPayload {
	const kind = payload.kind ?? 0;
	const raw = payload.raw ?? new Uint8Array();
	const index = payload.index ?? 0;
	const total = payload.total ?? 0;
	const chunkIndex = payload.chunkIndex ?? 0;
	const chunkTotal =
		payload.chunkTotal && payload.chunkTotal > 0 ? payload.chunkTotal : 1;

	return {
		kind,
		raw,
		index,
		total,
		chunkIndex,
		chunkTotal,
		chunkKey: `${kind}:${index}`,
	};
}

export function createErrorResult({
	state,
	code,
	message,
}: {
	state: VerifyTransferState;
	code: string;
	message: string;
}): DataResult {
	return {
		acks: [],
		error: {
			code,
			message,
		},
		authenticityReady: false,
		nfcStatus: getNfcTransferStatus(state),
		livenessStatus: getLivenessTransferStatus(state),
	};
}

export function createChunkRetryResult({
	state,
	kind,
	index,
	chunkIndex,
	reason,
}: {
	state: VerifyTransferState;
	kind: number;
	index: number;
	chunkIndex: number;
	reason: string;
}): DataResult {
	return createErrorResult({
		state,
		code: "DATA_CHUNK_RETRY",
		message: createChunkRetryMessage({
			kind,
			index,
			chunkIndex,
			reason,
		}),
	});
}

export function validateDataPayload({
	state,
	kind,
	raw,
	index,
	total,
	chunkIndex,
	chunkTotal,
	chunkKey,
}: NormalizedDataPayload & { state: VerifyTransferState }): DataResult | null {
	if (raw.length > MAX_FRAME_BYTES) {
		return createErrorResult({
			state,
			code: "FRAME_TOO_LARGE",
			message: "Verify frame exceeds the maximum allowed size.",
		});
	}

	if (!isNonNegativeInteger(kind)) {
		return createErrorResult({
			state,
			code: "UNKNOWN_DATA_KIND",
			message: "Unknown data kind.",
		});
	}

	if (isLegacySelfieDataKind(kind)) {
		return createErrorResult({
			state,
			code: "LEGACY_SELFIE_KIND_UNSUPPORTED",
			message:
				"Legacy three-still selfie uploads are no longer accepted. Upgrade the client and re-attempt verification.",
		});
	}

	if (!isSupportedDataKind(kind)) {
		return createErrorResult({
			state,
			code: "UNKNOWN_DATA_KIND",
			message: "Unknown data kind.",
		});
	}

	if (state.bytesReceived + raw.length > MAX_TOTAL_TRANSFER_BYTES) {
		return createErrorResult({
			state,
			code: "TRANSFER_TOO_LARGE",
			message: "Verify transfer exceeds the maximum allowed size.",
		});
	}

	if (!(isNonNegativeInteger(index) && isNonNegativeInteger(total))) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "invalid_index_or_total",
		});
	}

	if (isNfcDataKind(kind) && index !== 0) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "invalid_nfc_index",
		});
	}

	if (isLivenessVideoDataKind(kind) && total !== 1) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "invalid_liveness_artifact_total",
		});
	}

	if (isLivenessVideoDataKind(kind) && index !== 0) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "invalid_liveness_artifact_index",
		});
	}

	if (
		!(
			isNonNegativeInteger(chunkIndex) &&
			isNonNegativeInteger(chunkTotal) &&
			chunkIndex < chunkTotal
		)
	) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "invalid_chunk_range",
		});
	}

	if (chunkTotal > MAX_CHUNKS_PER_KEY) {
		return createErrorResult({
			state,
			code: "CHUNK_TOTAL_TOO_LARGE",
			message: "chunkTotal exceeds the maximum allowed value.",
		});
	}

	const existingChunkEntry = state.chunks.get(chunkKey);
	if (existingChunkEntry && existingChunkEntry.chunkTotal !== chunkTotal) {
		return createChunkRetryResult({
			state,
			kind,
			index,
			chunkIndex,
			reason: "chunk_total_mismatch",
		});
	}

	return null;
}
