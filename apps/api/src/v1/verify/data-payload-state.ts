import { parseChunkKey } from "./data-payload-chunks";
import {
	isLivenessVideoDataKind,
	LIVENESS_VIDEO_KIND,
} from "./data-payload-kinds";
import type { VerifyTransferState } from "./data-payload-types";

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

export function resetNfcTransferState(state: VerifyTransferState): void {
	state.dg1 = undefined;
	state.dg2 = undefined;
	state.sod = undefined;
	state.dg14 = undefined;
	state.dg15 = undefined;
	state.activeAuthChallenge = undefined;
	state.activeAuthSignature = undefined;
	state.chipAuthTranscript = undefined;
	state.nfcAttestAssertion = undefined;
	for (const key of Array.from(state.chunks.keys())) {
		const parsed = parseChunkKey(key);
		if (parsed && parsed.kind !== LIVENESS_VIDEO_KIND) {
			state.chunks.delete(key);
		}
	}
}

export function resetLivenessTransferState(state: VerifyTransferState): void {
	state.livenessVideo = undefined;
	for (const key of Array.from(state.chunks.keys())) {
		const parsed = parseChunkKey(key);
		if (parsed && isLivenessVideoDataKind(parsed.kind)) {
			state.chunks.delete(key);
		}
	}
}
