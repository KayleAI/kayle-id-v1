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
		delete process.env.NODE_ENV;
	}

	if (typeof originalRequireAttestation === "string") {
		process.env.VERIFY_REQUIRE_ATTESTATION = originalRequireAttestation;
	} else {
		delete process.env.VERIFY_REQUIRE_ATTESTATION;
	}
});

test("App Attest gate is always enabled in production", () => {
	expect(
		isAttestationGateEnabled({
			NODE_ENV: "production",
			VERIFY_REQUIRE_ATTESTATION: "false",
		} as CloudflareBindings),
	).toBeTrue();
});

test("App Attest gate can be explicitly enabled outside production", () => {
	expect(
		isAttestationGateEnabled({
			NODE_ENV: "test",
			VERIFY_REQUIRE_ATTESTATION: "true",
		} as CloudflareBindings),
	).toBeTrue();
});

test("App Attest gate remains off outside production unless explicitly enabled", () => {
	delete process.env.VERIFY_REQUIRE_ATTESTATION;

	expect(
		isAttestationGateEnabled({
			NODE_ENV: "test",
		} as CloudflareBindings),
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
