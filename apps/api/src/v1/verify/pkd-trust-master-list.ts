import { Set as Asn1Set, fromBER, Sequence } from "asn1js";
import { Certificate, ContentInfo, SignedData } from "pkijs";
import { ICAO_MASTER_LIST_OID } from "./pkd-trust-types";
import {
	asn1Buffer,
	bufferBytes,
	ensurePkijsEngine,
	octetStringBytes,
} from "./pkd-trust-utils";

export function extractCscaCertificatesFromMasterList(
	bytes: Uint8Array,
): Certificate[] {
	ensurePkijsEngine();
	const decoded = fromBER(bufferBytes(bytes));

	if (decoded.offset === -1) {
		throw new Error("master_list_parse_failed");
	}

	const contentInfo = new ContentInfo({
		schema: decoded.result,
	});

	if (contentInfo.contentType !== "1.2.840.113549.1.7.2") {
		throw new Error("master_list_content_type_invalid");
	}

	const signedData = new SignedData({
		schema: contentInfo.content,
	});

	if (signedData.encapContentInfo.eContentType !== ICAO_MASTER_LIST_OID) {
		throw new Error("master_list_econtent_type_invalid");
	}

	const eContent = signedData.encapContentInfo.eContent;

	if (!eContent) {
		throw new Error("master_list_content_missing");
	}

	const masterListBytes = octetStringBytes(eContent);
	const masterListAsn1 = fromBER(asn1Buffer(masterListBytes));

	if (
		masterListAsn1.offset === -1 ||
		!(masterListAsn1.result instanceof Sequence)
	) {
		throw new Error("master_list_content_invalid");
	}

	const [, certificateSet] = masterListAsn1.result.valueBlock.value;

	if (!(certificateSet instanceof Asn1Set)) {
		throw new Error("master_list_certificates_missing");
	}

	return certificateSet.valueBlock.value.map((entry) => {
		try {
			return new Certificate({
				schema: entry,
			});
		} catch {
			throw new Error("master_list_certificate_invalid");
		}
	});
}
