import { Hono } from "hono";
import { validator } from "hono/validator";
import { handleAttestChallenge } from "./attest-challenge-route";
import {
	ATTEST_CHALLENGE_RATE_LIMIT_MAX,
	checkAttestChallengeRateLimit,
	resolveAttestChallengeRateLimitIdentity,
} from "./attest-rate-limit";
import {
	handleAttestRegister,
	validateAttestRegisterBody,
} from "./attest-register-route";

export {
	ATTEST_CHALLENGE_RATE_LIMIT_MAX,
	checkAttestChallengeRateLimit,
	resolveAttestChallengeRateLimitIdentity,
};

const attest = new Hono<{ Bindings: CloudflareBindings }>();

attest.get("/challenge", handleAttestChallenge);
attest.post(
	"/register",
	validator("json", validateAttestRegisterBody),
	handleAttestRegister,
);

export default attest;
