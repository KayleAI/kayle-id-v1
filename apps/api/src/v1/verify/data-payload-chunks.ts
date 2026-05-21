import type {
	VerifyChunkEntry,
	VerifyTransferState,
} from "./data-payload-types";

export function isNonNegativeInteger(value: number): boolean {
	return Number.isInteger(value) && value >= 0;
}

export function parseChunkKey(
	key: string,
): { kind: number; index: number } | null {
	const [kindPart, indexPart] = key.split(":");
	const kind = Number(kindPart);
	const index = Number(indexPart);

	if (!(isNonNegativeInteger(kind) && isNonNegativeInteger(index))) {
		return null;
	}

	return { kind, index };
}

export function createChunkRetryMessage({
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

export function getMissingChunkIndices(entry: VerifyChunkEntry): number[] {
	const missing: number[] = [];
	for (let index = 0; index < entry.chunkTotal; index += 1) {
		if (!entry.parts.has(index)) {
			missing.push(index);
		}
	}
	return missing;
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

export function assembleChunk({
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
