/**
 * Chip Authentication algorithm registry per TR-03110-3 §A.2.1.
 *
 * The full OID arc is `bsi-de.2.2.3` where bsi-de = 0.4.0.127.0.7.
 * `id-CA-DH` adds `.1`, `id-CA-ECDH` adds `.2`. The trailing component picks
 * the symmetric cipher / MAC pair: 1=3DES-CBC-CBC, 2..4=AES-CBC-CMAC-{128,192,256}.
 *
 * The version (1 or 2) is carried separately in `ChipAuthenticationInfo.version`.
 */

import { ID_PK_DH_OID, ID_PK_ECDH_OID } from "./chip-auth-public-key-oids";

export const ID_CA_DH_3DES_CBC_CBC_OID = "0.4.0.127.0.7.2.2.3.1.1";
export const ID_CA_DH_AES_CBC_CMAC_128_OID = "0.4.0.127.0.7.2.2.3.1.2";
export const ID_CA_DH_AES_CBC_CMAC_192_OID = "0.4.0.127.0.7.2.2.3.1.3";
export const ID_CA_DH_AES_CBC_CMAC_256_OID = "0.4.0.127.0.7.2.2.3.1.4";

export const ID_CA_ECDH_3DES_CBC_CBC_OID = "0.4.0.127.0.7.2.2.3.2.1";
export const ID_CA_ECDH_AES_CBC_CMAC_128_OID = "0.4.0.127.0.7.2.2.3.2.2";
export const ID_CA_ECDH_AES_CBC_CMAC_192_OID = "0.4.0.127.0.7.2.2.3.2.3";
export const ID_CA_ECDH_AES_CBC_CMAC_256_OID = "0.4.0.127.0.7.2.2.3.2.4";

export type ChipAuthKeyAgreement = "DH" | "ECDH";
export type ChipAuthCipher =
	| "3DES-CBC"
	| "AES-CBC-128"
	| "AES-CBC-192"
	| "AES-CBC-256";
export type ChipAuthMac = "DES-CBC-MAC" | "AES-CMAC";
export type ChipAuthKdfHash = "SHA-1" | "SHA-256";

export type ChipAuthAlgorithm = {
	cipher: ChipAuthCipher;
	keyAgreement: ChipAuthKeyAgreement;
	/** Hash used by the TR-03110 KDF for this algorithm. */
	kdfHash: ChipAuthKdfHash;
	/** Length in bytes of K_MAC (and K_Enc) derived by the KDF. */
	keyLength: number;
	mac: ChipAuthMac;
	oid: string;
	/** OID for the matching ChipAuthenticationPublicKeyInfo entry. */
	publicKeyOid: typeof ID_PK_DH_OID | typeof ID_PK_ECDH_OID;
};

const ALGORITHMS: Record<string, ChipAuthAlgorithm> = {
	[ID_CA_DH_3DES_CBC_CBC_OID]: {
		cipher: "3DES-CBC",
		keyAgreement: "DH",
		kdfHash: "SHA-1",
		keyLength: 16,
		mac: "DES-CBC-MAC",
		oid: ID_CA_DH_3DES_CBC_CBC_OID,
		publicKeyOid: ID_PK_DH_OID,
	},
	[ID_CA_DH_AES_CBC_CMAC_128_OID]: {
		cipher: "AES-CBC-128",
		keyAgreement: "DH",
		kdfHash: "SHA-1",
		keyLength: 16,
		mac: "AES-CMAC",
		oid: ID_CA_DH_AES_CBC_CMAC_128_OID,
		publicKeyOid: ID_PK_DH_OID,
	},
	[ID_CA_DH_AES_CBC_CMAC_192_OID]: {
		cipher: "AES-CBC-192",
		keyAgreement: "DH",
		kdfHash: "SHA-256",
		keyLength: 24,
		mac: "AES-CMAC",
		oid: ID_CA_DH_AES_CBC_CMAC_192_OID,
		publicKeyOid: ID_PK_DH_OID,
	},
	[ID_CA_DH_AES_CBC_CMAC_256_OID]: {
		cipher: "AES-CBC-256",
		keyAgreement: "DH",
		kdfHash: "SHA-256",
		keyLength: 32,
		mac: "AES-CMAC",
		oid: ID_CA_DH_AES_CBC_CMAC_256_OID,
		publicKeyOid: ID_PK_DH_OID,
	},
	[ID_CA_ECDH_3DES_CBC_CBC_OID]: {
		cipher: "3DES-CBC",
		keyAgreement: "ECDH",
		kdfHash: "SHA-1",
		keyLength: 16,
		mac: "DES-CBC-MAC",
		oid: ID_CA_ECDH_3DES_CBC_CBC_OID,
		publicKeyOid: ID_PK_ECDH_OID,
	},
	[ID_CA_ECDH_AES_CBC_CMAC_128_OID]: {
		cipher: "AES-CBC-128",
		keyAgreement: "ECDH",
		kdfHash: "SHA-1",
		keyLength: 16,
		mac: "AES-CMAC",
		oid: ID_CA_ECDH_AES_CBC_CMAC_128_OID,
		publicKeyOid: ID_PK_ECDH_OID,
	},
	[ID_CA_ECDH_AES_CBC_CMAC_192_OID]: {
		cipher: "AES-CBC-192",
		keyAgreement: "ECDH",
		kdfHash: "SHA-256",
		keyLength: 24,
		mac: "AES-CMAC",
		oid: ID_CA_ECDH_AES_CBC_CMAC_192_OID,
		publicKeyOid: ID_PK_ECDH_OID,
	},
	[ID_CA_ECDH_AES_CBC_CMAC_256_OID]: {
		cipher: "AES-CBC-256",
		keyAgreement: "ECDH",
		kdfHash: "SHA-256",
		keyLength: 32,
		mac: "AES-CMAC",
		oid: ID_CA_ECDH_AES_CBC_CMAC_256_OID,
		publicKeyOid: ID_PK_ECDH_OID,
	},
};

export function chipAuthAlgorithmFromOid(
	oid: string,
): ChipAuthAlgorithm | null {
	return ALGORITHMS[oid] ?? null;
}

export function isChipAuthInfoOid(oid: string): boolean {
	return oid in ALGORITHMS;
}
