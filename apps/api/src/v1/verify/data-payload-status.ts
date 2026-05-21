import { getMissingChunkIndices, parseChunkKey } from "./data-payload-chunks";
import { isLivenessVideoDataKind, isNfcDataKind } from "./data-payload-kinds";
import type {
	LivenessTransferStatus,
	MissingTransferChunk,
	NfcTransferStatus,
	RequiredNfcArtifact,
	VerifyTransferState,
} from "./data-payload-types";

export function getNfcTransferStatus(
	state: VerifyTransferState,
): NfcTransferStatus {
	const missingArtifacts = getMissingNfcArtifacts(state);
	const missingChunks = getMissingTransferChunks(state, isNfcDataKind);

	return {
		complete: missingArtifacts.length === 0 && missingChunks.length === 0,
		missingArtifacts,
		missingChunks,
	};
}

export function getLivenessTransferStatus(
	state: VerifyTransferState,
): LivenessTransferStatus {
	const missingChunks = getMissingTransferChunks(
		state,
		isLivenessVideoDataKind,
	);

	return {
		complete: Boolean(state.livenessVideo) && missingChunks.length === 0,
		receivedBytes: state.livenessVideo?.length ?? 0,
		missingChunks,
	};
}

function getMissingNfcArtifacts(
	state: VerifyTransferState,
): RequiredNfcArtifact[] {
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

	return missingArtifacts;
}

function getMissingTransferChunks(
	state: VerifyTransferState,
	includeKind: (kind: number) => boolean,
): MissingTransferChunk[] {
	const missingChunks: MissingTransferChunk[] = [];

	for (const [key, entry] of state.chunks.entries()) {
		const parsed = parseChunkKey(key);
		if (!(parsed && includeKind(parsed.kind))) {
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

	return missingChunks;
}
