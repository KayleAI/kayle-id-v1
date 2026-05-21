import { readUint32BE, sha256, utf8FixedLength } from "./app-attest-bytes";
import type { AppAttestEnvironment } from "./app-attest-types";

export const APP_ATTEST_FMT = "apple-appattest";

const APP_ATTEST_RP_ID = "K667TL7H29.kayle.id";
const AAGUID_PRODUCTION = utf8FixedLength("appattest", 16);
const AAGUID_DEVELOPMENT = utf8FixedLength("appattestdevelop", 16);

export const AUTH_DATA_RP_ID_HASH_OFFSET = 0;
export const AUTH_DATA_FLAGS_OFFSET = 32;
export const AUTH_DATA_COUNTER_OFFSET = 33;
export const AUTH_DATA_AAGUID_OFFSET = 37;
export const AUTH_DATA_CRED_ID_LEN_OFFSET = 53;
export const AUTH_DATA_CRED_ID_OFFSET = 55;

export type AuthDataCredentialId =
	| {
			ok: true;
			credentialId: Uint8Array;
			endOffset: number;
	  }
	| { ok: false };

export function computeAppAttestRpIdHash(): Promise<Uint8Array> {
	return sha256(new TextEncoder().encode(APP_ATTEST_RP_ID));
}

export function expectedAaguidForEnvironment(
	environment: AppAttestEnvironment,
): Uint8Array {
	return environment === "production" ? AAGUID_PRODUCTION : AAGUID_DEVELOPMENT;
}

export function readAuthDataCounter(authData: Uint8Array): number {
	return readUint32BE(authData, AUTH_DATA_COUNTER_OFFSET);
}

export function readAuthDataCredentialId(
	authData: Uint8Array,
): AuthDataCredentialId {
	const credIdLen =
		(authData[AUTH_DATA_CRED_ID_LEN_OFFSET] ?? 0) * 256 +
		(authData[AUTH_DATA_CRED_ID_LEN_OFFSET + 1] ?? 0);
	const endOffset = AUTH_DATA_CRED_ID_OFFSET + credIdLen;

	if (endOffset > authData.length) {
		return { ok: false };
	}

	return {
		ok: true,
		credentialId: authData.slice(AUTH_DATA_CRED_ID_OFFSET, endOffset),
		endOffset,
	};
}
