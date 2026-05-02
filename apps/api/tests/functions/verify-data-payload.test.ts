import { describe, expect, test } from "bun:test";
import {
	createTransferState,
	getNfcTransferStatus,
	getSelfieTransferStatus,
	MAX_CHUNKS_PER_KEY,
	MAX_FRAME_BYTES,
	MAX_KIND_BYTES,
	MAX_TOTAL_TRANSFER_BYTES,
	processDataPayload,
} from "@/v1/verify/data-payload";

describe("verify data payload processor", () => {
	test("acks incomplete chunk payloads", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 0,
				chunkTotal: 2,
			},
		});

		expect(result.acks).toEqual(["data_chunk_ok_0_0_0"]);
		expect(result.authenticityReady).toBeFalse();
	});

	test("acks completed DG payloads and marks authenticity readiness", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
			},
		});

		processDataPayload({
			state,
			payload: {
				kind: 1,
				raw: new Uint8Array([2]),
				index: 0,
				total: 1,
			},
		});

		const result = processDataPayload({
			state,
			payload: {
				kind: 2,
				raw: new Uint8Array([3]),
				index: 0,
				total: 1,
			},
		});

		expect(result.acks).toEqual(["data_ok_2_0"]);
		expect(result.authenticityReady).toBeTrue();
		expect(result.nfcStatus.complete).toBeTrue();
	});

	test("supports out-of-order chunk reassembly for DG payloads", () => {
		const state = createTransferState();

		const firstChunk = processDataPayload({
			state,
			payload: {
				kind: 1,
				raw: new Uint8Array([2]),
				index: 0,
				total: 1,
				chunkIndex: 1,
				chunkTotal: 2,
			},
		});

		expect(firstChunk.acks).toEqual(["data_chunk_ok_1_0_1"]);

		const secondChunk = processDataPayload({
			state,
			payload: {
				kind: 1,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 0,
				chunkTotal: 2,
			},
		});

		expect(secondChunk.acks).toEqual(["data_ok_1_0"]);
		expect(Array.from(state.dg2 ?? new Uint8Array())).toEqual([1, 2]);
	});

	test("exposes missing chunk metadata for incomplete NFC artifacts", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 0,
				chunkTotal: 3,
			},
		});

		const status = getNfcTransferStatus(state);

		expect(status.complete).toBeFalse();
		expect(status.missingArtifacts).toEqual(["dg1", "dg2", "sod"]);
		expect(status.missingChunks).toEqual([
			{
				kind: 0,
				index: 0,
				chunkTotal: 3,
				missingChunkIndices: [1, 2],
			},
		]);
	});

	test("returns DATA_CHUNK_RETRY for invalid chunk metadata", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 1,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 2,
				chunkTotal: 2,
			},
		});

		expect(result.error?.code).toBe("DATA_CHUNK_RETRY");
		expect(result.acks).toEqual([]);
		expect(result.authenticityReady).toBeFalse();
	});

	test("stores selfie payloads by index idempotently", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([1]),
				index: 0,
				total: 3,
			},
		});

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([9]),
				index: 0,
				total: 3,
			},
		});

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([2]),
				index: 1,
				total: 3,
			},
		});

		const status = getSelfieTransferStatus(state);
		expect(status.complete).toBeFalse();
		expect(status.requiredTotal).toBe(3);
		expect(status.missingSelfieIndexes).toEqual([2]);
		expect(Array.from(state.selfies.get(0) ?? new Uint8Array())).toEqual([9]);
	});

	test("exposes missing selfie chunks for incomplete selfie artifacts", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([1]),
				index: 0,
				total: 3,
				chunkIndex: 1,
				chunkTotal: 2,
			},
		});

		const status = getSelfieTransferStatus(state);
		expect(status.complete).toBeFalse();
		expect(status.requiredTotal).toBe(3);
		expect(status.missingSelfieIndexes).toEqual([0, 1, 2]);
		expect(status.missingChunks).toEqual([
			{
				kind: 3,
				index: 0,
				chunkTotal: 2,
				missingChunkIndices: [0],
			},
		]);
	});

	test("selfie completeness passes only with indices 0, 1, and 2", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([1]),
				index: 0,
				total: 3,
			},
		});

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([2]),
				index: 1,
				total: 3,
			},
		});

		let status = getSelfieTransferStatus(state);
		expect(status.complete).toBeFalse();
		expect(status.missingSelfieIndexes).toEqual([2]);

		processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([3]),
				index: 2,
				total: 3,
			},
		});

		status = getSelfieTransferStatus(state);
		expect(status.complete).toBeTrue();
		expect(status.missingSelfieIndexes).toEqual([]);
	});

	test("rejects a single frame larger than MAX_FRAME_BYTES", () => {
		const state = createTransferState();
		const oversizeFrame = new Uint8Array(MAX_FRAME_BYTES + 1);

		const result = processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: oversizeFrame,
				index: 0,
				total: 1,
			},
		});

		expect(result.error?.code).toBe("FRAME_TOO_LARGE");
		expect(state.bytesReceived).toBe(0);
	});

	test("rejects a transfer that would exceed MAX_TOTAL_TRANSFER_BYTES", () => {
		const state = createTransferState();
		state.bytesReceived = MAX_TOTAL_TRANSFER_BYTES;

		const result = processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
			},
		});

		expect(result.error?.code).toBe("TRANSFER_TOO_LARGE");
	});

	test("rejects a chunkTotal greater than MAX_CHUNKS_PER_KEY", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 0,
				chunkTotal: MAX_CHUNKS_PER_KEY + 1,
			},
		});

		expect(result.error?.code).toBe("CHUNK_TOTAL_TOO_LARGE");
	});

	test("rejects an assembled artifact larger than MAX_KIND_BYTES", () => {
		const state = createTransferState();
		const chunkBytes = MAX_FRAME_BYTES; // 256 KiB
		const chunkTotal = Math.ceil(MAX_KIND_BYTES / chunkBytes) + 1; // pushes past 8 MiB
		const chunk = new Uint8Array(chunkBytes);

		// Send all chunks except the last; each individual frame is exactly at
		// the per-frame cap so they slip past FRAME_TOO_LARGE, but they keep
		// growing state.bytesReceived. The final assemble will then exceed
		// MAX_KIND_BYTES.
		for (let chunkIndex = 0; chunkIndex < chunkTotal - 1; chunkIndex += 1) {
			const intermediate = processDataPayload({
				state,
				payload: {
					kind: 0,
					raw: chunk,
					index: 0,
					total: 1,
					chunkIndex,
					chunkTotal,
				},
			});
			expect(intermediate.error).toBeUndefined();
		}

		const final = processDataPayload({
			state,
			payload: {
				kind: 0,
				raw: chunk,
				index: 0,
				total: 1,
				chunkIndex: chunkTotal - 1,
				chunkTotal,
			},
		});

		expect(final.error?.code).toBe("ARTIFACT_TOO_LARGE");
	});
});
