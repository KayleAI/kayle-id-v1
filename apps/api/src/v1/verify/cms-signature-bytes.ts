import { OctetString } from "asn1js";
import type { SignedData, SignerInfo } from "pkijs";
import {
	createDigest,
	signerDigestAlgorithm,
} from "./cms-signature-algorithms";
import { bytesEqual, exactBytes, octetStringBytes } from "./sod-asn1-utils";
import {
	CONTENT_TYPE_ATTRIBUTE_OID,
	MESSAGE_DIGEST_ATTRIBUTE_OID,
} from "./sod-constants";

function encapsulatedContentBytes(signedData: SignedData): Uint8Array {
	const eContent = signedData.encapContentInfo.eContent;

	if (!eContent) {
		throw new Error("cms_content_missing");
	}

	if (eContent.idBlock.tagClass === 1 && eContent.idBlock.tagNumber === 4) {
		return exactBytes(new Uint8Array(eContent.getValue()));
	}

	return exactBytes(eContent.valueBlock.valueBeforeDecodeView);
}

function signedAttributeMessageDigest(
	signerInfo: SignerInfo,
): Uint8Array | null {
	if (!signerInfo.signedAttrs) {
		return null;
	}

	let sawContentType = false;
	let messageDigest: Uint8Array | null = null;

	for (const attribute of signerInfo.signedAttrs.attributes) {
		if (attribute.type === CONTENT_TYPE_ATTRIBUTE_OID) {
			sawContentType = true;
			continue;
		}

		if (attribute.type !== MESSAGE_DIGEST_ATTRIBUTE_OID) {
			continue;
		}

		const [digestValue] = attribute.values;

		if (!(digestValue instanceof OctetString)) {
			throw new Error("cms_signed_attributes_invalid");
		}

		messageDigest = octetStringBytes(digestValue);
	}

	if (!(sawContentType && messageDigest)) {
		throw new Error("cms_signed_attributes_invalid");
	}

	return messageDigest;
}

function signedAttributesSignatureBytes(signerInfo: SignerInfo): Uint8Array {
	if (!signerInfo.signedAttrs) {
		throw new Error("cms_signed_attributes_invalid");
	}

	const signedAttributesBytes = exactBytes(
		new Uint8Array(signerInfo.signedAttrs.encodedValue),
	);

	if (signedAttributesBytes[0] === 0xa0) {
		signedAttributesBytes[0] = 0x31;
	}

	return signedAttributesBytes;
}

export async function signedDataBytesForSignature({
	signedData,
	signerInfo,
}: {
	signedData: SignedData;
	signerInfo: SignerInfo;
}): Promise<Uint8Array> {
	if (!signerInfo.signedAttrs) {
		return encapsulatedContentBytes(signedData);
	}

	const digestAlgorithm = signerDigestAlgorithm(signerInfo);

	if (!digestAlgorithm) {
		throw new Error("cms_signature_digest_algorithm_invalid");
	}

	const expectedMessageDigest = signedAttributeMessageDigest(signerInfo);

	if (!expectedMessageDigest) {
		throw new Error("cms_signed_attributes_invalid");
	}

	const actualMessageDigest = await createDigest(
		digestAlgorithm,
		encapsulatedContentBytes(signedData),
	);

	if (!bytesEqual(actualMessageDigest, expectedMessageDigest)) {
		throw new Error("cms_signed_attributes_digest_mismatch");
	}

	return signedAttributesSignatureBytes(signerInfo);
}
