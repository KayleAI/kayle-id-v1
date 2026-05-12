import { describe, expect, test } from "bun:test";
import {
	createTransferState,
	getLivenessTransferStatus,
	getNfcTransferStatus,
	MAX_CHUNKS_PER_KEY,
	MAX_FRAME_BYTES,
	MAX_KIND_BYTES,
	MAX_TOTAL_TRANSFER_BYTES,
	processDataPayload,
} from "@/v1/verify/data-payload";

const LIVENESS_VIDEO_KIND = 8;

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

	test("rejects unsupported data kinds before allocating chunk state", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 99,
				raw: new Uint8Array(),
				index: 1000,
				total: 1,
				chunkIndex: 0,
				chunkTotal: 2,
			},
		});

		expect(result.error?.code).toBe("UNKNOWN_DATA_KIND");
		expect(state.chunks.size).toBe(0);
		expect(state.bytesReceived).toBe(0);
	});

	test("rejects the legacy selfie kind explicitly", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 3,
				raw: new Uint8Array([1]),
				index: 0,
				total: 3,
			},
		});

		expect(result.error?.code).toBe("LEGACY_SELFIE_KIND_UNSUPPORTED");
	});

	test("rejects nonzero NFC indexes before allocating chunk state", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: 1,
				raw: new Uint8Array(),
				index: 1,
				total: 1,
				chunkIndex: 0,
				chunkTotal: 2,
			},
		});

		expect(result.error?.code).toBe("DATA_CHUNK_RETRY");
		expect(result.error?.message).toContain("invalid_nfc_index");
		expect(state.chunks.size).toBe(0);
		expect(state.bytesReceived).toBe(0);
	});

	test("stores a single liveness video payload", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: LIVENESS_VIDEO_KIND,
				raw: new Uint8Array([1, 2, 3, 4]),
				index: 0,
				total: 1,
			},
		});

		expect(result.acks).toEqual([`data_ok_${LIVENESS_VIDEO_KIND}_0`]);

		const status = getLivenessTransferStatus(state);
		expect(status.complete).toBeTrue();
		expect(status.receivedBytes).toBe(4);
		expect(Array.from(state.livenessVideo ?? new Uint8Array())).toEqual([
			1, 2, 3, 4,
		]);
	});

	test("rejects a liveness payload with a non-zero index", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: LIVENESS_VIDEO_KIND,
				raw: new Uint8Array([1]),
				index: 1,
				total: 1,
			},
		});

		expect(result.error?.code).toBe("DATA_CHUNK_RETRY");
		expect(result.error?.message).toContain("invalid_liveness_index");
	});

	test("rejects a liveness payload with total != 1", () => {
		const state = createTransferState();

		const result = processDataPayload({
			state,
			payload: {
				kind: LIVENESS_VIDEO_KIND,
				raw: new Uint8Array([1]),
				index: 0,
				total: 2,
			},
		});

		expect(result.error?.code).toBe("DATA_CHUNK_RETRY");
		expect(result.error?.message).toContain("invalid_liveness_total");
	});

	test("exposes missing chunk metadata for incomplete liveness uploads", () => {
		const state = createTransferState();

		processDataPayload({
			state,
			payload: {
				kind: LIVENESS_VIDEO_KIND,
				raw: new Uint8Array([1]),
				index: 0,
				total: 1,
				chunkIndex: 1,
				chunkTotal: 2,
			},
		});

		const status = getLivenessTransferStatus(state);
		expect(status.complete).toBeFalse();
		expect(status.receivedBytes).toBe(0);
		expect(status.missingChunks).toEqual([
			{
				kind: LIVENESS_VIDEO_KIND,
				index: 0,
				chunkTotal: 2,
				missingChunkIndices: [0],
			},
		]);
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
		const chunkTotal = Math.ceil(MAX_KIND_BYTES / chunkBytes) + 1;
		const chunk = new Uint8Array(chunkBytes);

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
