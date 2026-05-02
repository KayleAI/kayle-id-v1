import { fromBER, OctetString } from "asn1js";
import {
	AuthorityKeyIdentifier,
	Certificate,
	CertificateRevocationList,
	setEngine,
} from "pkijs";
import {
	AUTHORITY_KEY_IDENTIFIER_OID,
	SUBJECT_KEY_IDENTIFIER_OID,
} from "./pkd-trust-types";

let pkijsConfigured = false;

export function ensurePkijsEngine(): void {
	if (pkijsConfigured) {
		return;
	}

	setEngine("kayle-id-worker", crypto, crypto.subtle);
	pkijsConfigured = true;
}

export function exactBytes(bytes: Uint8Array): Uint8Array {
	return new Uint8Array(bytes);
}

export function bufferBytes(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

export function hexBytes(bytes: Uint8Array): string {
	return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
		"",
	);
}

export function asn1Buffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

export function resolveStringEnvValue(
	env: unknown,
	key: string,
): string | null {
	if (!(env && typeof env === "object")) {
		return null;
	}

	const candidate = Reflect.get(env, key);
	return typeof candidate === "string" && candidate.length > 0
		? candidate
		: null;
}

export function decodeBase64(value: string): Uint8Array {
	if (typeof Buffer !== "undefined") {
		return new Uint8Array(Buffer.from(value, "base64"));
	}

	const binary = atob(value);
	const decoded = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		decoded[index] = binary.charCodeAt(index);
	}

	return decoded;
}

export function encodeBase64(bytes: Uint8Array): string {
	if (typeof Buffer !== "undefined") {
		return Buffer.from(bytes).toString("base64");
	}

	let binary = "";

	for (const value of bytes) {
		binary += String.fromCharCode(value);
	}

	return btoa(binary);
}

function shortOid(oid: string): string {
	switch (oid) {
		case "2.5.4.3":
			return "CN";
		case "2.5.4.6":
			return "C";
		case "2.5.4.7":
			return "L";
		case "2.5.4.8":
			return "ST";
		case "2.5.4.10":
			return "O";
		case "2.5.4.11":
			return "OU";
		case "2.5.4.5":
			return "SERIALNUMBER";
		case "1.2.840.113549.1.9.1":
			return "EMAILADDRESS";
		default:
			return oid;
	}
}

function attributeValueText(value: unknown): string {
	const candidate = value as {
		toJSON?: () => unknown;
		valueBlock?: {
			value?: string;
			valueDec?: number;
		};
	};

	if (typeof candidate.valueBlock?.value === "string") {
		return candidate.valueBlock.value;
	}

	if (typeof candidate.valueBlock?.valueDec === "number") {
		return String(candidate.valueBlock.valueDec);
	}

	return JSON.stringify(candidate.toJSON?.() ?? {});
}

export function formatRelativeDistinguishedName(
	name: Certificate["subject"] | CertificateRevocationList["issuer"],
): string {
	return name.typesAndValues
		.map(
			(entry) => `${shortOid(entry.type)}=${attributeValueText(entry.value)}`,
		)
		.join(", ");
}

export function relativeDistinguishedNameKey(
	name: Certificate["subject"] | CertificateRevocationList["issuer"],
): string {
	return hexBytes(new Uint8Array(name.toSchema().toBER(false)));
}

function parseOctetString(value: ArrayBuffer): Uint8Array | null {
	const parsed = fromBER(value);

	if (parsed.offset === -1 || !(parsed.result instanceof OctetString)) {
		return null;
	}

	return octetStringBytes(parsed.result);
}

export function octetStringBytes(value: OctetString): Uint8Array {
	if (!value.idBlock.isConstructed) {
		return exactBytes(value.valueBlock.valueHexView);
	}

	const parts = value.valueBlock.value.map((child) => {
		if (!(child instanceof OctetString)) {
			throw new Error("invalid_octet_string_child");
		}

		return octetStringBytes(child);
	});
	const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
	const combined = new Uint8Array(totalLength);
	let offset = 0;

	for (const part of parts) {
		combined.set(part, offset);
		offset += part.length;
	}

	return combined;
}

function parseAuthorityKeyIdentifier(
	value: ArrayBuffer,
): AuthorityKeyIdentifier | null {
	const parsed = fromBER(value);

	if (parsed.offset === -1) {
		return null;
	}

	try {
		return new AuthorityKeyIdentifier({
			schema: parsed.result,
		});
	} catch {
		return null;
	}
}

async function computeSubjectKeyIdentifier(cert: Certificate): Promise<string> {
	return hexBytes(new Uint8Array(await cert.getKeyHash("SHA-1")));
}

export function subjectKeyIdentifierHex(
	cert: Certificate,
): Promise<string | null> {
	const subjectKeyIdentifier = cert.extensions?.find(
		(extension) => extension.extnID === SUBJECT_KEY_IDENTIFIER_OID,
	);
	const parsedValue = subjectKeyIdentifier
		? parseOctetString(subjectKeyIdentifier.extnValue.valueBlock.valueHex)
		: null;

	if (parsedValue) {
		return Promise.resolve(hexBytes(parsedValue));
	}

	return Promise.resolve(null);
}

export async function subjectKeyIdentifierHexOrKeyHash(
	cert: Certificate,
): Promise<string> {
	return (
		(await subjectKeyIdentifierHex(cert)) ?? computeSubjectKeyIdentifier(cert)
	);
}

export function authorityKeyIdentifierHex(input: {
	extensions?:
		| Certificate["extensions"]
		| CertificateRevocationList["crlExtensions"];
}): string | null {
	const extensions = Array.isArray(input.extensions)
		? input.extensions
		: input.extensions?.extensions;
	const authorityKeyIdentifier = extensions?.find(
		(extension) => extension.extnID === AUTHORITY_KEY_IDENTIFIER_OID,
	);
	const parsed = authorityKeyIdentifier
		? parseAuthorityKeyIdentifier(
				authorityKeyIdentifier.extnValue.valueBlock.valueHex,
			)
		: null;
	const keyIdentifier = parsed?.keyIdentifier;

	return keyIdentifier ? hexBytes(keyIdentifier.valueBlock.valueHexView) : null;
}

export function parseDerCertificate(bytes: Uint8Array): Certificate {
	ensurePkijsEngine();
	const decoded = fromBER(asn1Buffer(bytes));

	if (decoded.offset === -1) {
		throw new Error("certificate_parse_failed");
	}

	return new Certificate({
		schema: decoded.result,
	});
}

export function parseDerCertificateRevocationList(
	bytes: Uint8Array,
): CertificateRevocationList {
	ensurePkijsEngine();
	const decoded = fromBER(asn1Buffer(bytes));

	if (decoded.offset === -1) {
		throw new Error("crl_parse_failed");
	}

	return new CertificateRevocationList({
		schema: decoded.result,
	});
}

export function dscIssuerSerialKey(
	issuerKey: string,
	serialNumberHex: string,
): string {
	return `${issuerKey}:${serialNumberHex.toLowerCase()}`;
}

export function addIndexedValue<T>(
	index: Map<string, T[]>,
	key: string | null,
	value: T,
): void {
	if (!key) {
		return;
	}

	const existing = index.get(key);

	if (existing) {
		existing.push(value);
		return;
	}

	index.set(key, [value]);
}
