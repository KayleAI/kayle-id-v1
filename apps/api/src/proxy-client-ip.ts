import {
	CLIENT_IP_SOURCE_HEADERS,
	FORWARDED_CLIENT_IP_HEADER,
	getForwardedClientIp,
} from "@kayle-id/config/client-ip";
import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
import { createHMAC } from "@/functions/hmac";

const CF_GEOLOCATION_HEADER = "x-cf-geolocation";
const CF_SIGNATURE_HEADER = "x-cf-signature";

export function stripClientProxyHeaders(headers: Headers): void {
	headers.delete(FORWARDED_CLIENT_IP_HEADER);
	headers.delete(CF_GEOLOCATION_HEADER);
	headers.delete(CF_SIGNATURE_HEADER);

	for (const header of CLIENT_IP_SOURCE_HEADERS) {
		headers.delete(header);
	}
}

export async function hasSignedProxyMetadata(
	headers: Headers,
	internalToken: string,
): Promise<boolean> {
	const encodedCf = headers.get(CF_GEOLOCATION_HEADER);
	const signature = headers.get(CF_SIGNATURE_HEADER);

	if (!(encodedCf && signature)) {
		return false;
	}

	let serializedCf: string;
	try {
		serializedCf = atob(encodedCf);
	} catch {
		return false;
	}

	const expectedSignature = await createHMAC(serializedCf, {
		algorithm: "SHA256",
		secret: internalToken,
	});

	return constantTimeStringEqual(expectedSignature, signature.toLowerCase());
}

export async function resolveTrustedClientIp({
	headers,
	internalToken,
}: {
	headers: Headers;
	internalToken: string;
}): Promise<string | undefined> {
	const forwardedClientIp = headers.get(FORWARDED_CLIENT_IP_HEADER)?.trim();
	if (
		forwardedClientIp &&
		(await hasSignedProxyMetadata(headers, internalToken))
	) {
		return forwardedClientIp;
	}

	return getForwardedClientIp(headers);
}
