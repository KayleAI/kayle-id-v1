import type { BiometricVerifierServiceBinding } from "./biometric-verifier-types";

function resolveStringEnvValue(env: unknown, key: string): string | null {
	if (!env || typeof env !== "object") {
		return null;
	}

	const candidate = Reflect.get(env, key);
	return typeof candidate === "string" && candidate.length > 0
		? candidate
		: null;
}

export function resolveBiometricVerifierServiceBinding(
	env: unknown,
): BiometricVerifierServiceBinding | null {
	if (!(env && typeof env === "object")) {
		return null;
	}

	const candidate = Reflect.get(env, "BIOMETRIC_VERIFIER");

	if (!(candidate && typeof candidate === "object")) {
		return null;
	}

	const fetchBinding = Reflect.get(candidate, "fetch");

	return typeof fetchBinding === "function"
		? (candidate as BiometricVerifierServiceBinding)
		: null;
}

export function resolveBiometricVerifierSecret(env: unknown): string | null {
	return resolveStringEnvValue(env, "BIOMETRIC_VERIFIER_SECRET");
}
