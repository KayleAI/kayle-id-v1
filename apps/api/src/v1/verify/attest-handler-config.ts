export const ATTEST_CHALLENGE_BYTES = 32;
export const ATTEST_CHALLENGE_BASE64URL_LENGTH = 43;
export const ATTEST_CHALLENGE_TTL_SECONDS = 5 * 60;
export const ATTEST_CHALLENGE_REDIS_PREFIX = "attest:register_challenge:";
export const ATTEST_CHALLENGE_RATE_LIMIT_PREFIX = "attest:challenge_rate:";
export const ATTEST_CHALLENGE_RATE_LIMIT_WINDOW_SECONDS = 60;
export const ATTEST_CHALLENGE_RATE_LIMIT_MAX = 20;
export const ANONYMOUS_CHALLENGE_RATE_LIMIT_ID = "anonymous";

const MAX_ATTESTATION_BYTES = 64 * 1024;
export const MAX_ATTESTATION_BASE64_LENGTH =
	Math.ceil(MAX_ATTESTATION_BYTES / 3) * 4 + 4;
export const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
