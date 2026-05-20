import { afterEach, expect, test } from "bun:test";
import { createTransferState } from "@/v1/verify/data-payload";
import type { VerifySocketContext } from "@/v1/verify/socket-context";
import {
	buildMissingDataMessage,
	shouldRejectSuccessfulFallbackMatch,
} from "@/v1/verify/socket-phase-validation";

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
	if (typeof originalNodeEnv === "string") {
		process.env.NODE_ENV = originalNodeEnv;
		return;
	}

	(process.env as Record<string, string | undefined>).NODE_ENV = undefined;
});

test("blocks successful fallback face-match in production", () => {
	process.env.NODE_ENV = "production";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			result: {
				livenessPassed: true,
				livenessScore: 0.95,
				faceMatchPassed: true,
				faceMatchScore: 1,
				padPassed: true,
				padScore: 0.85,
				usedFallback: true,
			},
		}),
	).toBeTrue();
});

test("allows successful primary face-match in production", () => {
	process.env.NODE_ENV = "production";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			result: {
				livenessPassed: true,
				livenessScore: 0.95,
				faceMatchPassed: true,
				faceMatchScore: 0.91,
				padPassed: true,
				padScore: 0.85,
				usedFallback: false,
			},
		}),
	).toBeFalse();
});

test("allows successful fallback matches outside production", () => {
	process.env.NODE_ENV = "test";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			result: {
				livenessPassed: true,
				livenessScore: 0.95,
				faceMatchPassed: true,
				faceMatchScore: 1,
				padPassed: true,
				padScore: 0.85,
				usedFallback: true,
			},
		}),
	).toBeFalse();
});

function buildPhaseContextWithTransfer(
	configure?: (state: ReturnType<typeof createTransferState>) => void,
): VerifySocketContext {
	const transfer = createTransferState();
	configure?.(transfer);
	return {
		state: {
			confirmedFaceScore: null,
			sessionId: "vs_test",
			currentPhase: null,
			helloReceived: true,
			shareManifest: null,
			shareRequestSent: false,
			transfer,
		},
	} as unknown as VerifySocketContext;
}

test("liveness_complete with empty NFC reports NFC missing", () => {
	const context = buildPhaseContextWithTransfer();

	const result = buildMissingDataMessage(context, "liveness_complete");

	expect(result?.code).toBe("NFC_REQUIRED_DATA_MISSING");
	const parsed = JSON.parse(result?.message ?? "{}") as {
		missing_artifacts: string[];
	};
	expect(parsed.missing_artifacts).toEqual(["dg1", "dg2", "sod"]);
});

test("liveness_complete with NFC present but liveness video missing reports liveness missing", () => {
	const context = buildPhaseContextWithTransfer((transfer) => {
		transfer.dg1 = new Uint8Array([1]);
		transfer.dg2 = new Uint8Array([2]);
		transfer.sod = new Uint8Array([3]);
	});

	const result = buildMissingDataMessage(context, "liveness_complete");

	expect(result?.code).toBe("LIVENESS_REQUIRED_DATA_MISSING");
});

test("liveness_complete with NFC and liveness video present returns null", () => {
	const context = buildPhaseContextWithTransfer((transfer) => {
		transfer.dg1 = new Uint8Array([1]);
		transfer.dg2 = new Uint8Array([2]);
		transfer.sod = new Uint8Array([3]);
		transfer.livenessVideo = new Uint8Array([10, 11, 12]);
	});

	expect(buildMissingDataMessage(context, "liveness_complete")).toBeNull();
});
