export type VerifyChunkEntry = {
	chunkTotal: number;
	parts: Map<number, Uint8Array>;
};

type RequiredNfcArtifact = "dg1" | "dg2" | "sod";
const DG1_KIND = 0;
const DG2_KIND = 1;
const SOD_KIND = 2;
// Field number 3 (legacy three-stills selfie) is reserved in the Cap'n Proto
// schema. The server rejects this kind during validation.
const LEGACY_SELFIE_KIND = 3;
const DG14_KIND = 4;
const DG15_KIND = 5;
const ACTIVE_AUTH_KIND = 6;
const CHIP_AUTH_KIND = 7;
const LIVENESS_VIDEO_KIND = 8;
const ACTIVE_AUTH_CHALLENGE_BYTES = 8;

// Size caps for inbound verify uploads. These are intentionally conservative
// and may need to be widened with telemetry from real-world passport reads.
// Each cap is checked before storage to keep memory pressure bounded and to
// prevent slow-loris-style streaming exhaustion of a Worker isolate.
export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_CHUNKS_PER_KEY = 256;
// Sized for H.264 baseline @ 720×1280 @ 1.6 Mbps × ~8 s liveness clip with
// codec-overshoot headroom; passport DG2 portraits fit well under this.
export const MAX_KIND_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_TRANSFER_BYTES = 48 * 1024 * 1024;

export type MissingTransferChunk = {
	kind: number;
	index: number;
	chunkTotal: number;
	missingChunkIndices: number[];
};

export type MissingNfcChunk = MissingTransferChunk;

export type NfcTransferStatus = {
	complete: boolean;
	missingArtifacts: RequiredNfcArtifact[];
	missingChunks: MissingNfcChunk[];
};

export type LivenessTransferStatus = {
	complete: boolean;
	receivedBytes: number;
	missingChunks: MissingTransferChunk[];
};

export type VerifyTransferState = {
	dg1?: Uint8Array;
	dg2?: Uint8Array;
	sod?: Uint8Array;
	dg14?: Uint8Array;
	dg15?: Uint8Array;
	activeAuthChallenge?: Uint8Array;
	activeAuthSignature?: Uint8Array;
	chipAuthTranscript?: Uint8Array;
	/**
	 * App Attest assertion bound to the NFC-completion artifacts. Set when the
	 * client sends `phase = "nfc_complete"` with a populated `attestAssertion`
	 * field; consumed once by `runAttestationValidation` ahead of PA/CA/AA.
	 */
	nfcAttestAssertion?: Uint8Array;
	livenessVideo?: Uint8Array;
	chunks: Map<string, VerifyChunkEntry>;
	/** Cumulative bytes received across all chunks/artifacts for this attempt. */
	bytesReceived: number;
};

export type VerifyDataPayload = {
	kind?: number;
	raw?: Uint8Array;
	index?: number;
	total?: number;
	chunkIndex?: number;
	chunkTotal?: number;
};

type DataResult = {
	acks: string[];
	error?: {
		code: string;
		message: string;
	};
	authenticityReady: boolean;
	nfcStatus: NfcTransferStatus;
	livenessStatus: LivenessTransferStatus;
};

export function createTransferState(): VerifyTransferState {
	return {
		chunks: new Map(),
		bytesReceived: 0,
	};
}

export function resetTransferState(state: VerifyTransferState): void {
	state.livenessVideo = undefined;
	state.dg1 = undefined;
	state.dg2 = undefined;
	state.sod = undefined;
	state.dg14 = undefined;
	state.dg15 = undefined;
	state.activeAuthChallenge = undefined;
	state.activeAuthSignature = undefined;
	state.chipAuthTranscript = undefined;
	state.nfcAttestAssertion = undefined;
	state.chunks.clear();
	state.bytesReceived = 0;
}

function isNonNegativeInteger(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

function parseChunkKey(key: string): { kind: number; index: number } | null {
	const [kindPart, indexPart] = key.split(":");
	const kind = Number(kindPart);
	const index = Number(indexPart);

	if (!(isNonNegativeInteger(kind) && isNonNegativeInteger(index))) {
		return null;
	}

	return { kind, index };
}

function createChunkRetryMessage({
	kind,
	index,
	chunkIndex,
	reason,
}: {
	kind: number;
	index: number;
	chunkIndex: number;
	reason: string;
}): string {
	return JSON.stringify({
		kind,
		index,
		chunkIndex,
		reason,
	});
}

function getMissingChunkIndices(entry: VerifyChunkEntry): number[] {
	const missing: number[] = [];
	for (let index = 0; index < entry.chunkTotal; index += 1) {
		if (!entry.parts.has(index)) {
			missing.push(index);
		}
	}
	return missing;
}

export function isNfcDataKind(kind: number): boolean {
	return (
		kind === DG1_KIND ||
		kind === DG2_KIND ||
		kind === SOD_KIND ||
		kind === DG14_KIND ||
		kind === DG15_KIND ||
		kind === ACTIVE_AUTH_KIND ||
		kind === CHIP_AUTH_KIND
	);
}

export function isLivenessVideoDataKind(kind: number): boolean {
	return kind === LIVENESS_VIDEO_KIND;
}

function isLegacySelfieDataKind(kind: number): boolean {
	return kind === LEGACY_SELFIE_KIND;
}

function isSupportedDataKind(kind: number): boolean {
	return isNfcDataKind(kind) || isLivenessVideoDataKind(kind);
}

export function getNfcTransferStatus(
	state: VerifyTransferState,
): NfcTransferStatus {
	const missingArtifacts: RequiredNfcArtifact[] = [];

	if (!state.dg1) {
		missingArtifacts.push("dg1");
	}
	if (!state.dg2) {
		missingArtifacts.push("dg2");
	}
	if (!state.sod) {
		missingArtifacts.push("sod");
	}

	const missingChunks: MissingNfcChunk[] = [];

	for (const [key, entry] of state.chunks.entries()) {
		const parsed = parseChunkKey(key);
		if (!(parsed && isNfcDataKind(parsed.kind))) {
			continue;
		}

		const missingChunkIndices = getMissingChunkIndices(entry);
		if (missingChunkIndices.length === 0) {
			continue;
		}

		missingChunks.push({
			kind: parsed.kind,
			index: parsed.index,
			chunkTotal: entry.chunkTotal,
			missingChunkIndices,
		});
	}

	return {
		complete: missingArtifacts.length === 0 && missingChunks.length === 0,
		missingArtifacts,
		missingChunks,
	};
}

export function getLivenessTransferStatus(
	state: VerifyTransferState,
): LivenessTransferStatus {
	const missingChunks: MissingTransferChunk[] = [];

	for (const [key, entry] of state.chunks.entries()) {
		const parsed = parseChunkKey(key);
		if (!(parsed && isLivenessVideoDataKind(parsed.kind))) {
			continue;
		}

		const missingChunkIndices = getMissingChunkIndices(entry);
		if (missingChunkIndices.length === 0) {
			continue;
		}

		missingChunks.push({
			kind: parsed.kind,
			index: parsed.index,
			chunkTotal: entry.chunkTotal,
			missingChunkIndices,
		});
	}

	const receivedBytes = state.livenessVideo?.length ?? 0;

	return {
		complete: Boolean(state.livenessVideo) && missingChunks.length === 0,
		receivedBytes,
		missingChunks,
	};
}

function getOrCreateChunkEntry(
	chunks: Map<string, VerifyChunkEntry>,
	key: string,
	chunkTotal: number,
): VerifyChunkEntry {
	const existing = chunks.get(key);
	if (existing) {
		return existing;
	}

	const entry = {
		chunkTotal,
		parts: new Map<number, Uint8Array>(),
	};
	chunks.set(key, entry);
	return entry;
}

function collectChunks(entry: VerifyChunkEntry): Uint8Array[] | null {
	const buffers: Uint8Array[] = [];

	for (let index = 0; index < entry.chunkTotal; index += 1) {
		const part = entry.parts.get(index);
		if (!part) {
			return null;
		}
		buffers.push(part);
	}

	return buffers;
}

function mergeChunks(parts: Uint8Array[]): Uint8Array {
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const merged = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		merged.set(part, offset);
		offset += part.length;
	}

	return merged;
}

function assembleChunk({
	state,
	key,
	chunkIndex,
	chunkTotal,
	chunk,
}: {
	state: VerifyTransferState;
	key: string;
	chunkIndex: number;
	chunkTotal: number;
	chunk: Uint8Array;
}): { complete: boolean; data?: Uint8Array } {
	if (chunkTotal <= 1) {
		state.bytesReceived += chunk.length;
		return { complete: true, data: chunk };
	}

	const entry = getOrCreateChunkEntry(state.chunks, key, chunkTotal);
	const isNewPart = !entry.parts.has(chunkIndex);
	entry.parts.set(chunkIndex, chunk);

	if (isNewPart) {
		state.bytesReceived += chunk.length;
	}

	if (entry.parts.size < entry.chunkTotal) {
		return { complete: false };
	}

	const buffers = collectChunks(entry);
	if (!buffers) {
		return { complete: false };
	}

	const merged = mergeChunks(buffers);
	state.chunks.delete(key);
	return { complete: true, data: merged };
}

function storeActiveAuthData(
	state: VerifyTransferState,
	data: Uint8Array,
): { ok: true } | { ok: false; code: string; message: string } {
	if (data.length <= ACTIVE_AUTH_CHALLENGE_BYTES) {
		return {
			ok: false,
			code: "ACTIVE_AUTH_PAYLOAD_INVALID",
			message: "Active authentication payload is invalid.",
		};
	}

	state.activeAuthChallenge = data.slice(0, ACTIVE_AUTH_CHALLENGE_BYTES);
	state.activeAuthSignature = data.slice(ACTIVE_AUTH_CHALLENGE_BYTES);
	return { ok: true };
}

function storeData({
	state,
	kind,
	data,
}: {
	state: VerifyTransferState;
	kind: number;
	data: Uint8Array;
}): { ok: true } | { ok: false; code: string; message: string } {
	if (data.length > MAX_KIND_BYTES) {
		return {
			ok: false,
			code: "ARTIFACT_TOO_LARGE",
			message: "Verify artifact exceeds the maximum allowed size.",
		};
	}

	switch (kind) {
		case DG1_KIND:
			state.dg1 = data;
			return { ok: true };
		case DG2_KIND:
			state.dg2 = data;
			return { ok: true };
		case SOD_KIND:
			state.sod = data;
			return { ok: true };
		case DG14_KIND:
			state.dg14 = data;
			return { ok: true };
		case DG15_KIND:
			state.dg15 = data;
			return { ok: true };
		case ACTIVE_AUTH_KIND:
			return storeActiveAuthData(state, data);
		case CHIP_AUTH_KIND:
			state.chipAuthTranscript = data;
			return { ok: true };
		case LIVENESS_VIDEO_KIND:
			state.livenessVideo = data;
			return { ok: true };
		default:
			return {
				ok: false,
				code: "UNKNOWN_DATA_KIND",
				message: "Unknown data kind.",
			};
	}
}

function isAuthenticityReady(state: VerifyTransferState): boolean {
	return Boolean(state.dg1 && state.dg2 && state.sod);
}

type NormalizedDataPayload = {
	kind: number;
	raw: Uint8Array;
	index: number;
	total: number;
	chunkIndex: number;
	chunkTotal: number;
	chunkKey: string;
};

function normalizeDataPayload(
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

function createErrorResult({
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

function createChunkRetryResult({
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

function validateDataPayload({
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

	// Liveness video is one artefact per attempt — `(index, total)`
	// MUST be `(0, 1)`; chunks live on the `chunkIndex`/`chunkTotal`
	// axis instead.
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
