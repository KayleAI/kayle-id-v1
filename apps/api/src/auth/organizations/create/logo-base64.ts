import { LogoValidationError } from "./logo-policy";

export function decodeBase64LogoData(data: string): Uint8Array {
	let binary: string;

	try {
		binary = atob(data);
	} catch {
		throw new LogoValidationError(
			"Organization logo data must be base64 encoded.",
		);
	}

	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}
