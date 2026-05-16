import { afterEach, expect, test } from "bun:test";
import {
	isAttestationGateEnabled,
	resolveAppAttestEnvironment,
} from "@/v1/verify/attest-gate";

const originalNodeEnv = process.env.NODE_ENV;
const originalRequireAttestation = process.env.VERIFY_REQUIRE_ATTESTATION;

afterEach(() => {
	if (typeof originalNodeEnv === "string") {
		process.env.NODE_ENV = originalNodeEnv;
	} else {
		(process.env as Record<string, string | undefined>).NODE_ENV = undefined;
	}

	if (typeof originalRequireAttestation === "string") {
		process.env.VERIFY_REQUIRE_ATTESTATION = originalRequireAttestation;
	} else {
		(
			process.env as Record<string, string | undefined>
		).VERIFY_REQUIRE_ATTESTATION = undefined;
	}
});

test("App Attest gate is always enabled in production", () => {
	expect(
		isAttestationGateEnabled({
			NODE_ENV: "production",
			VERIFY_REQUIRE_ATTESTATION: "false",
		} as unknown as CloudflareBindings),
	).toBeTrue();
});

test("App Attest gate can be explicitly enabled outside production", () => {
	expect(
		isAttestationGateEnabled({
			NODE_ENV: "test",
			VERIFY_REQUIRE_ATTESTATION: "true",
		} as unknown as CloudflareBindings),
	).toBeTrue();
});

test("App Attest gate remains off outside production unless explicitly enabled", () => {
	(
		process.env as Record<string, string | undefined>
	).VERIFY_REQUIRE_ATTESTATION = undefined;

	expect(
		isAttestationGateEnabled({
			NODE_ENV: "test",
		} as unknown as CloudflareBindings),
	).toBeFalse();
});

test("App Attest environment follows NODE_ENV production before URL config", () => {
	expect(
		resolveAppAttestEnvironment({
			NODE_ENV: "production",
			PUBLIC_AUTH_URL: "http://localhost:3000",
		} as CloudflareBindings),
	).toBe("production");
});

test("App Attest environment still treats the public Kayle URL as production", () => {
	expect(
		resolveAppAttestEnvironment({
			NODE_ENV: "test",
			PUBLIC_AUTH_URL: "https://kayle.id",
		} as CloudflareBindings),
	).toBe("production");
});

test("App Attest environment is development on staging even though NODE_ENV=production", () => {
	// Staging deliberately runs with NODE_ENV=production to mirror real
	// prod runtime, but iOS DEBUG builds (the only client that can point at
	// staging) produce development-AAGUID attestations. Without this branch
	// every register call would fail with `aaguid_mismatch`.
	expect(
		resolveAppAttestEnvironment({
			KAYLE_ENVIRONMENT: "staging",
			NODE_ENV: "production",
			PUBLIC_AUTH_URL: "https://staging.kayle.id",
		} as CloudflareBindings),
	).toBe("development");
});

test("App Attest environment is production when KAYLE_ENVIRONMENT is production", () => {
	expect(
		resolveAppAttestEnvironment({
			KAYLE_ENVIRONMENT: "production",
			NODE_ENV: "production",
			PUBLIC_AUTH_URL: "https://kayle.id",
		} as CloudflareBindings),
	).toBe("production");
});
