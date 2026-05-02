const PEM_PUBLIC_KEY_HEADER = "-----BEGIN PUBLIC KEY-----";
const PEM_PUBLIC_KEY_FOOTER = "-----END PUBLIC KEY-----";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isJwkObject(value: unknown): value is JsonWebKey {
	if (!isRecord(value)) {
		return false;
	}

	return typeof value.kty === "string" && value.kty.trim().length > 0;
}

export function parseJwkInput(input: string): JsonWebKey {
	const trimmed = input.trim();

	if (!trimmed) {
		throw new Error("Public JWK is required.");
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(trimmed);
	} catch {
		throw new Error("Public JWK must be valid JSON.");
	}

	if (!isRecord(parsed)) {
		throw new Error("Public JWK must be a JSON object.");
	}

	if (!isJwkObject(parsed)) {
		throw new Error("Public JWK must include a non-empty string `kty` field.");
	}

	return parsed;
}

function decodeBase64ToArrayBuffer(input: string): ArrayBuffer {
	const decoded = atob(input);
	const bytes = new Uint8Array(decoded.length);

	for (let index = 0; index < decoded.length; index += 1) {
		bytes[index] = decoded.charCodeAt(index);
	}

	return bytes.buffer.slice(0);
}

function isPemPublicKey(input: string): boolean {
	return (
		input.includes(PEM_PUBLIC_KEY_HEADER) &&
		input.includes(PEM_PUBLIC_KEY_FOOTER)
	);
}

async function parsePemPublicKeyInput(input: string): Promise<JsonWebKey> {
	const normalized = input
		.replace(PEM_PUBLIC_KEY_HEADER, "")
		.replace(PEM_PUBLIC_KEY_FOOTER, "")
		.replace(/\s+/gu, "");

	if (!normalized) {
		throw new Error("Public PEM must contain key material.");
	}

	let cryptoKey: CryptoKey;

	try {
		cryptoKey = await crypto.subtle.importKey(
			"spki",
			decodeBase64ToArrayBuffer(normalized),
			{
				name: "RSA-OAEP",
				hash: "SHA-256",
			},
			true,
			["encrypt"],
		);
	} catch {
		throw new Error(
			"Public PEM must be a valid RSA public key in BEGIN PUBLIC KEY format.",
		);
	}

	const exported = await crypto.subtle.exportKey("jwk", cryptoKey);

	return {
		...exported,
		alg: exported.alg ?? "RSA-OAEP-256",
		ext: exported.ext ?? true,
		key_ops:
			exported.key_ops && exported.key_ops.length > 0
				? exported.key_ops
				: ["encrypt"],
	};
}

export function parsePublicKeyInput(input: string): Promise<JsonWebKey> {
	const trimmed = input.trim();

	if (!trimmed) {
		return Promise.reject(new Error("Public key is required."));
	}

	if (trimmed.startsWith("{")) {
		return Promise.resolve().then(() => parseJwkInput(trimmed));
	}

	if (isPemPublicKey(trimmed)) {
		return parsePemPublicKeyInput(trimmed);
	}

	return Promise.reject(
		new Error(
			"Paste a public JWK JSON object or a PEM public key in BEGIN PUBLIC KEY format.",
		),
	);
}
