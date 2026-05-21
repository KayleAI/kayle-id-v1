import {
	ACTIVE_AUTH_CHALLENGE_BYTES,
	ACTIVE_AUTH_KIND,
	CHIP_AUTH_KIND,
	DG1_KIND,
	DG2_KIND,
	DG14_KIND,
	DG15_KIND,
	LIVENESS_VIDEO_KIND,
	MAX_KIND_BYTES,
	SOD_KIND,
} from "./data-payload-kinds";
import type { VerifyTransferState } from "./data-payload-types";

export function storeData({
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

export function isAuthenticityReady(state: VerifyTransferState): boolean {
	return Boolean(state.dg1 && state.dg2 && state.sod);
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
