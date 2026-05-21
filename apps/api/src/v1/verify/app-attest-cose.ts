import { type CborValue, decodeCbor } from "./app-attest-cbor";

const COSE_EC2_KTY = 2;
const COSE_ALG_ES256 = -7;
const COSE_CRV_P256 = 1;

export function parseCoseEc2Key(bytes: Uint8Array): {
	x: Uint8Array;
	y: Uint8Array;
} {
	const { value } = decodeCbor(bytes, 0);
	if (!(value instanceof Map)) {
		throw new Error("cose_key_not_map");
	}

	const kty = coseGet(value, 1);
	const alg = coseGet(value, 3);
	const crv = coseGet(value, -1);
	const x = coseGet(value, -2);
	const y = coseGet(value, -3);

	if (kty !== COSE_EC2_KTY) throw new Error("cose_kty_not_ec2");
	if (alg !== COSE_ALG_ES256) throw new Error("cose_alg_not_es256");
	if (crv !== COSE_CRV_P256) throw new Error("cose_crv_not_p256");
	if (!(x instanceof Uint8Array) || x.length !== 32) {
		throw new Error("cose_x_invalid");
	}
	if (!(y instanceof Uint8Array) || y.length !== 32) {
		throw new Error("cose_y_invalid");
	}

	return { x, y };
}

function coseGet(map: Map<CborValue, CborValue>, key: number): CborValue {
	for (const [k, v] of map) {
		if (k === key) return v;
	}
	throw new Error(`cose_key_missing:${key}`);
}
