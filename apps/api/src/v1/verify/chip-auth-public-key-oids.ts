/**
 * Chip Authentication public-key algorithm OIDs per TR-03110-3 §A.2.1.2.
 *
 * Used both as the algorithm identifier inside `ChipAuthenticationPublicKeyInfo`
 * and as the inner OID of the Authenticated Public Key Token over which the
 * CA-v2 chip token T_PICC is computed.
 */

export const ID_PK_DH_OID = "0.4.0.127.0.7.2.2.1.1";
export const ID_PK_ECDH_OID = "0.4.0.127.0.7.2.2.1.2";

export type ChipAuthPublicKeyAlgorithm = "DH" | "ECDH";

export function chipAuthPublicKeyAlgorithmFromOid(
	oid: string,
): ChipAuthPublicKeyAlgorithm | null {
	switch (oid) {
		case ID_PK_DH_OID:
			return "DH";
		case ID_PK_ECDH_OID:
			return "ECDH";
		default:
			return null;
	}
}
