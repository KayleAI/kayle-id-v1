import {
	getLivenessTransferStatus,
	getNfcTransferStatus,
} from "./data-payload";
import type { VerifySocketContext } from "./socket-context";

type MissingDataMessage = {
	code: "NFC_REQUIRED_DATA_MISSING" | "LIVENESS_REQUIRED_DATA_MISSING";
	message: string;
};

type MissingChunk = ReturnType<
	typeof getNfcTransferStatus
>["missingChunks"][number];

export function buildMissingDataMessage(
	context: VerifySocketContext,
	nextPhase: string,
): MissingDataMessage | null {
	if (nextPhase === "nfc_complete") {
		const status = getNfcTransferStatus(context.state.transfer);
		return status.complete ? null : buildMissingNfcDataMessage(status);
	}

	if (nextPhase !== "liveness_complete") {
		return null;
	}

	const nfcStatus = getNfcTransferStatus(context.state.transfer);
	if (!nfcStatus.complete) {
		return buildMissingNfcDataMessage(nfcStatus);
	}

	const status = getLivenessTransferStatus(context.state.transfer);

	return status.complete
		? null
		: {
				code: "LIVENESS_REQUIRED_DATA_MISSING",
				message: JSON.stringify({
					received_bytes: status.receivedBytes,
					missing_chunks: mapMissingChunks(status.missingChunks),
				}),
			};
}

function buildMissingNfcDataMessage(
	status: ReturnType<typeof getNfcTransferStatus>,
): { code: "NFC_REQUIRED_DATA_MISSING"; message: string } {
	return {
		code: "NFC_REQUIRED_DATA_MISSING",
		message: JSON.stringify({
			missing_artifacts: status.missingArtifacts,
			missing_chunks: mapMissingChunks(status.missingChunks),
		}),
	};
}

function mapMissingChunks(chunks: MissingChunk[]) {
	return chunks.map((chunk) => ({
		kind: chunk.kind,
		index: chunk.index,
		chunk_total: chunk.chunkTotal,
		missing_chunk_indices: chunk.missingChunkIndices,
	}));
}
