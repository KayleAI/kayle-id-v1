import type { AppAttestEnvironment } from "./app-attest";

export function isAttestationGateEnabled(env: CloudflareBindings): boolean {
	const nodeEnv =
		(env as { NODE_ENV?: string }).NODE_ENV ?? process.env.NODE_ENV;
	if (nodeEnv === "production") {
		return true;
	}

	const flag =
		(env as { VERIFY_REQUIRE_ATTESTATION?: string })
			.VERIFY_REQUIRE_ATTESTATION ?? process.env.VERIFY_REQUIRE_ATTESTATION;
	return flag === "true";
}

export function resolveAppAttestEnvironment(
	env: CloudflareBindings,
): AppAttestEnvironment {
	const kayleEnv =
		(env as { KAYLE_ENVIRONMENT?: string }).KAYLE_ENVIRONMENT ??
		process.env.KAYLE_ENVIRONMENT;
	if (kayleEnv === "production") {
		return "production";
	}
	if (
		kayleEnv === "staging" ||
		kayleEnv === "test" ||
		kayleEnv === "development"
	) {
		return "development";
	}

	const nodeEnv =
		(env as { NODE_ENV?: string }).NODE_ENV ?? process.env.NODE_ENV;
	return nodeEnv === "production" || env.PUBLIC_AUTH_URL === "https://kayle.id"
		? "production"
		: "development";
}
