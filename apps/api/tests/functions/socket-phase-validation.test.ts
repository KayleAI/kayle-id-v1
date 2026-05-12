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

test("blocks successful fallback matches in production", () => {
	process.env.NODE_ENV = "production";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			faceResult: {
				faceScore: 1,
				passed: true,
				usedFallback: true,
			},
		}),
	).toBeTrue();
});

test("allows successful primary matches in production", () => {
	process.env.NODE_ENV = "production";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			faceResult: {
				faceScore: 0.91,
				passed: true,
				usedFallback: false,
			},
		}),
	).toBeFalse();
});

test("allows successful fallback matches outside production", () => {
	process.env.NODE_ENV = "test";

	expect(
		shouldRejectSuccessfulFallbackMatch({
			faceResult: {
				faceScore: 1,
				passed: true,
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
			acceptedFaceScore: null,
			attemptId: "att_test",
			currentPhase: null,
			helloReceived: true,
			shareManifest: null,
			shareRequestSent: false,
			transfer,
		},
	} as VerifySocketContext;
}

test("selfie_complete with empty NFC reports NFC missing", () => {
	const context = buildPhaseContextWithTransfer();

	const result = buildMissingDataMessage(context, "selfie_complete");

	expect(result?.code).toBe("NFC_REQUIRED_DATA_MISSING");
	const parsed = JSON.parse(result?.message ?? "{}") as {
		missing_artifacts: string[];
	};
	expect(parsed.missing_artifacts).toEqual(["dg1", "dg2", "sod"]);
});

test("selfie_complete with NFC present but selfies missing reports selfie missing", () => {
	const context = buildPhaseContextWithTransfer((transfer) => {
		transfer.dg1 = new Uint8Array([1]);
		transfer.dg2 = new Uint8Array([2]);
		transfer.sod = new Uint8Array([3]);
	});

	const result = buildMissingDataMessage(context, "selfie_complete");

	expect(result?.code).toBe("SELFIE_REQUIRED_DATA_MISSING");
});

test("selfie_complete with NFC and all selfies present returns null", () => {
	const context = buildPhaseContextWithTransfer((transfer) => {
		transfer.dg1 = new Uint8Array([1]);
		transfer.dg2 = new Uint8Array([2]);
		transfer.sod = new Uint8Array([3]);
		transfer.selfies.set(0, new Uint8Array([10]));
		transfer.selfies.set(1, new Uint8Array([11]));
		transfer.selfies.set(2, new Uint8Array([12]));
	});

	expect(buildMissingDataMessage(context, "selfie_complete")).toBeNull();
});
