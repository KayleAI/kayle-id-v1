import { BIOMETRIC_VERIFIER_AUTH_HEADER } from "@kayle-id/config/biometric-verifier";
import {
	BIOMETRIC_VERIFIER_INTERNAL_ORIGIN,
	type BiometricVerifierServiceBinding,
} from "./biometric-verifier-types";

export function createBiometricVerifierRequest({
	path,
	method,
	verifierSecret,
	body,
}: {
	path: string;
	method: "GET" | "POST";
	verifierSecret: string;
	body?: BodyInit;
}): Request {
	return new Request(
		new URL(path, BIOMETRIC_VERIFIER_INTERNAL_ORIGIN).toString(),
		{
			body,
			headers: {
				authorization: `Bearer ${verifierSecret}`,
				[BIOMETRIC_VERIFIER_AUTH_HEADER]: verifierSecret,
			},
			method,
		},
	);
}

export async function fetchBiometricVerifier(
	verifierBinding: BiometricVerifierServiceBinding,
	request: Request,
): Promise<Response> {
	return Reflect.apply(verifierBinding.fetch, verifierBinding, [
		request,
	]) as Promise<Response>;
}
