import { concat, sha256, textBytes } from "./attest-gate-bytes";
import type { VerifyTransferState } from "./data-payload";

export async function buildNfcClientDataHash({
	sessionId,
	challenge,
	transfer,
}: {
	sessionId: string;
	challenge: Uint8Array;
	transfer: VerifyTransferState;
}): Promise<Uint8Array> {
	const dg1Hash = await sha256(transfer.dg1 ?? new Uint8Array());
	const dg2Hash = await sha256(transfer.dg2 ?? new Uint8Array());
	const dg14Hash = await sha256(transfer.dg14 ?? new Uint8Array());
	const dg15Hash = await sha256(transfer.dg15 ?? new Uint8Array());
	const sodHash = await sha256(transfer.sod ?? new Uint8Array());
	const chipAuthHash = await sha256(
		transfer.chipAuthTranscript ?? new Uint8Array(),
	);
	const aaSignatureHash = await sha256(
		transfer.activeAuthSignature ?? new Uint8Array(),
	);

	return await sha256(
		concat(
			textBytes("attest:nfc:"),
			textBytes(sessionId),
			dg1Hash,
			dg2Hash,
			dg14Hash,
			dg15Hash,
			sodHash,
			chipAuthHash,
			aaSignatureHash,
			challenge,
		),
	);
}
