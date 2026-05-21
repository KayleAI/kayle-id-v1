export const DG1_KIND = 0;
export const DG2_KIND = 1;
export const SOD_KIND = 2;
const LEGACY_SELFIE_KIND = 3;
export const DG14_KIND = 4;
export const DG15_KIND = 5;
export const ACTIVE_AUTH_KIND = 6;
export const CHIP_AUTH_KIND = 7;
export const LIVENESS_VIDEO_KIND = 8;
export const ACTIVE_AUTH_CHALLENGE_BYTES = 8;

export const MAX_FRAME_BYTES = 256 * 1024;
export const MAX_CHUNKS_PER_KEY = 256;
export const MAX_KIND_BYTES = 16 * 1024 * 1024;
export const MAX_TOTAL_TRANSFER_BYTES = 48 * 1024 * 1024;

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

export function isLegacySelfieDataKind(kind: number): boolean {
	return kind === LEGACY_SELFIE_KIND;
}

export function isSupportedDataKind(kind: number): boolean {
	return isNfcDataKind(kind) || isLivenessVideoDataKind(kind);
}
