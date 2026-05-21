function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

export async function deriveEcdhSharedSecret({
	chipPoint,
	curveCoordBytes,
	curveName,
	terminalPoint,
	terminalScalar,
}: {
	chipPoint: Uint8Array;
	curveCoordBytes: number;
	curveName: string;
	terminalPoint: Uint8Array;
	terminalScalar: Uint8Array;
}): Promise<Uint8Array> {
	if (chipPoint.length !== 1 + 2 * curveCoordBytes) {
		throw new Error("chip_auth_chip_point_length_invalid");
	}

	if (terminalPoint.length !== 1 + 2 * curveCoordBytes) {
		throw new Error("chip_auth_terminal_point_length_invalid");
	}

	if (terminalScalar.length !== curveCoordBytes) {
		throw new Error("chip_auth_terminal_scalar_length_invalid");
	}

	const terminalX = terminalPoint.slice(1, 1 + curveCoordBytes);
	const terminalY = terminalPoint.slice(1 + curveCoordBytes);
	const chipX = chipPoint.slice(1, 1 + curveCoordBytes);
	const chipY = chipPoint.slice(1 + curveCoordBytes);

	const privateKey = await crypto.subtle.importKey(
		"jwk",
		{
			crv: curveName,
			d: bytesToBase64Url(terminalScalar),
			ext: true,
			key_ops: ["deriveBits"],
			kty: "EC",
			x: bytesToBase64Url(terminalX),
			y: bytesToBase64Url(terminalY),
		},
		{ name: "ECDH", namedCurve: curveName },
		false,
		["deriveBits"],
	);

	const publicKey = await crypto.subtle.importKey(
		"jwk",
		{
			crv: curveName,
			ext: true,
			kty: "EC",
			x: bytesToBase64Url(chipX),
			y: bytesToBase64Url(chipY),
		},
		{ name: "ECDH", namedCurve: curveName },
		false,
		[],
	);

	const bits = await crypto.subtle.deriveBits(
		{ $public: publicKey, name: "ECDH", public: publicKey } as never,
		privateKey,
		curveCoordBytes * 8,
	);

	return new Uint8Array(bits);
}
