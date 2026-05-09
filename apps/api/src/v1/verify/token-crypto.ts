export { constantTimeStringEqual } from "@kayle-id/config/constant-time";

import { env } from "@kayle-id/config/env";
import { createHMAC } from "@/functions/hmac";
import { generateRandomString } from "@/utils/generate-id";

export const SESSION_CANCEL_TOKEN_LENGTH = 48;
export const SESSION_CANCEL_TOKEN_PATTERN = /^[a-z0-9]+$/u;

export function generateMobileWriteTokenSeed(): string {
	return generateRandomString(64);
}

export function generateSessionCancelToken(): string {
	return generateRandomString(SESSION_CANCEL_TOKEN_LENGTH);
}

export function hashSessionCancelToken(token: string): Promise<string> {
	return createHMAC(`verify_cancel_token_v1|${token}`, {
		secret: env.AUTH_SECRET,
	});
}

export function deriveMobileWriteToken({
	sessionId,
	attemptId,
	issuedAt,
	seed,
}: {
	sessionId: string;
	attemptId: string;
	issuedAt: Date;
	seed: string;
}): Promise<string> {
	return createHMAC(
		`verify_handoff_token_v1|${sessionId}|${attemptId}|${issuedAt.toISOString()}|${seed}`,
		{
			secret: env.AUTH_SECRET,
		},
	);
}

export function hashMobileWriteToken(token: string): Promise<string> {
	return createHMAC(token, {
		secret: env.AUTH_SECRET,
	});
}

export function hashMobileDeviceId(deviceId: string): Promise<string> {
	return createHMAC(deviceId, {
		secret: env.AUTH_SECRET,
	});
}
