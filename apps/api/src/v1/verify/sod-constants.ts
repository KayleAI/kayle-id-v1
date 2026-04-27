export const ICAO_LDS_SECURITY_OBJECT_OID = "2.23.136.1.1.1";
export const CMS_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";
export const SOD_ROOT_TAG = 0x77;

export const SHA_1_OID = "1.3.14.3.2.26";
export const SHA_256_OID = "2.16.840.1.101.3.4.2.1";
export const SHA_384_OID = "2.16.840.1.101.3.4.2.2";
export const SHA_512_OID = "2.16.840.1.101.3.4.2.3";

export const CONTENT_TYPE_ATTRIBUTE_OID = "1.2.840.113549.1.9.3";
export const MESSAGE_DIGEST_ATTRIBUTE_OID = "1.2.840.113549.1.9.4";

export const ECDSA_PUBLIC_KEY_OID = "1.2.840.10045.2.1";
export const EC_PRIME_FIELD_OID = "1.2.840.10045.1.1";
export const RSA_ENCRYPTION_OID = "1.2.840.113549.1.1.1";
export const RSA_PSS_OID = "1.2.840.113549.1.1.10";

export const OID_PATTERN = /^\d+(?:\.\d+)+$/;
export const SUPPORTED_NAMED_CURVES = ["P-256", "P-384", "P-521"] as const;

export const EXPLICIT_EC_CURVES = [
	{
		aHex: "ffffffff00000001000000000000000000000000fffffffffffffffffffffffc",
		bHex: "5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b",
		cofactorHex: "01",
		fieldTypeOid: EC_PRIME_FIELD_OID,
		generatorHex:
			"046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5",
		name: "P-256",
		namedCurveOid: "1.2.840.10045.3.1.7",
		orderHex:
			"ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551",
		primeHex:
			"ffffffff00000001000000000000000000000000ffffffffffffffffffffffff",
	},
	{
		aHex: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffc",
		bHex: "b3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aef",
		cofactorHex: "01",
		fieldTypeOid: EC_PRIME_FIELD_OID,
		generatorHex:
			"04aa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab73617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5f",
		name: "P-384",
		namedCurveOid: "1.3.132.0.34",
		orderHex:
			"ffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973",
		primeHex:
			"fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffff",
	},
	{
		aHex: "01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc",
		bHex: "0051953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00",
		cofactorHex: "01",
		fieldTypeOid: EC_PRIME_FIELD_OID,
		generatorHex:
			"0400c6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66011839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650",
		name: "P-521",
		namedCurveOid: "1.3.132.0.35",
		orderHex:
			"01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409",
		primeHex:
			"01ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
	},
] as const;

export type ExplicitEcCurveParameters = {
	aHex: string;
	bHex: string;
	cofactorHex: string | null;
	fieldTypeOid: string;
	generatorHex: string;
	orderHex: string;
	primeHex: string;
};
