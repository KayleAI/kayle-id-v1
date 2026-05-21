import { ICAO_CHALLENGE_BYTES } from "./active-auth-result";
import { bufferBytes } from "./sod-asn1-utils";

const ACTIVE_AUTH_CHALLENGE_LABEL = "aa:";

export async function deriveActiveAuthChallenge({
	sessionId,
	authSecret,
}: {
	sessionId: string;
	authSecret: string;
}): Promise<Uint8Array> {
	const secretBytes = new TextEncoder().encode(authSecret);
	const payloadBytes = new TextEncoder().encode(
		`${ACTIVE_AUTH_CHALLENGE_LABEL}${sessionId}`,
	);
	const key = await crypto.subtle.importKey(
		"raw",
		bufferBytes(secretBytes),
		{
			hash: "SHA-256",
			name: "HMAC",
		},
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		bufferBytes(payloadBytes),
	);

	return new Uint8Array(signature).slice(0, ICAO_CHALLENGE_BYTES);
}
