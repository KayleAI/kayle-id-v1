import { Integer, OctetString, Sequence } from "asn1js";
import { AlgorithmIdentifier, ContentInfo, SignedData } from "pkijs";
import { ensurePkijsEngine } from "./pkd-trust";
import {
	octetStringBytes,
	parseBer,
	subtleAlgorithmFromOid,
} from "./sod-asn1-utils";
import {
	CMS_SIGNED_DATA_OID,
	ICAO_LDS_SECURITY_OBJECT_OID,
	SOD_ROOT_TAG,
} from "./sod-constants";
import { readTlv } from "./tlv";
import type { SupportedHashAlgorithm } from "./validation-types";

export type ParsedSodSecurityObject = {
	algorithm: SupportedHashAlgorithm;
	dg1Hash: Uint8Array;
	dg2Hash: Uint8Array;
	dgHashes: Map<number, Uint8Array>;
	signedData: SignedData;
};

function parseContentInfo(sod: Uint8Array): ContentInfo {
	const schema = parseBer(unwrapSodContentInfoBytes(sod), "sod_parse_failed");

	try {
		return new ContentInfo({
			schema,
		});
	} catch {
		throw new Error("sod_parse_failed");
	}
}

function unwrapSodContentInfoBytes(sod: Uint8Array): Uint8Array {
	try {
		const root = readTlv(sod, 0);

		if (root.tag === SOD_ROOT_TAG && root.nextOffset === sod.length) {
			return root.value;
		}
	} catch {
		return sod;
	}

	return sod;
}

function parseSignedData(contentInfo: ContentInfo): SignedData {
	if (contentInfo.contentType !== CMS_SIGNED_DATA_OID) {
		throw new Error("sod_content_type_invalid");
	}

	try {
		return new SignedData({
			schema: contentInfo.content,
		});
	} catch {
		throw new Error("sod_parse_failed");
	}
}

function parseLdsSecurityObjectRoot(signedData: SignedData): Sequence {
	if (
		signedData.encapContentInfo.eContentType !== ICAO_LDS_SECURITY_OBJECT_OID
	) {
		throw new Error("lds_security_object_missing");
	}

	const eContent = signedData.encapContentInfo.eContent;

	if (!eContent) {
		throw new Error("lds_security_object_missing");
	}

	const result = parseBer(
		octetStringBytes(eContent),
		"lds_security_object_parse_failed",
	);

	if (!(result instanceof Sequence)) {
		throw new Error("lds_security_object_invalid");
	}

	return result;
}

function parseLdsSecurityObjectNodes(root: Sequence): {
	hashAlgorithmNode: Sequence;
	hashValuesNode: Sequence;
} {
	const [versionNode, hashAlgorithmNode, hashValuesNode] =
		root.valueBlock.value;

	if (
		!(
			versionNode instanceof Integer &&
			hashAlgorithmNode instanceof Sequence &&
			hashValuesNode instanceof Sequence
		)
	) {
		throw new Error("lds_security_object_invalid");
	}

	return {
		hashAlgorithmNode,
		hashValuesNode,
	};
}

function parseDigestAlgorithm(
	hashAlgorithmNode: Sequence,
): SupportedHashAlgorithm {
	const hashAlgorithm = new AlgorithmIdentifier({
		schema: hashAlgorithmNode,
	});
	const algorithm = subtleAlgorithmFromOid(hashAlgorithm.algorithmId);

	if (!algorithm) {
		throw new Error("unsupported_digest_algorithm");
	}

	return algorithm;
}

function parseDgHashEntry(child: unknown): {
	dataGroupNumber: number;
	digest: Uint8Array;
} {
	if (!(child instanceof Sequence) || child.valueBlock.value.length < 2) {
		throw new Error("dg_hash_entry_invalid");
	}

	const [dataGroupNumberNode, dataGroupHashNode] = child.valueBlock.value;

	if (
		!(
			dataGroupNumberNode instanceof Integer &&
			dataGroupHashNode instanceof OctetString
		)
	) {
		throw new Error("dg_hash_entry_invalid");
	}

	return {
		dataGroupNumber: dataGroupNumberNode.valueBlock.valueDec,
		digest: octetStringBytes(dataGroupHashNode),
	};
}

function parseRequiredDgHashes(hashValuesNode: Sequence): {
	dg1Hash: Uint8Array;
	dg2Hash: Uint8Array;
	dgHashes: Map<number, Uint8Array>;
} {
	const dgHashes = new Map<number, Uint8Array>();

	for (const child of hashValuesNode.valueBlock.value) {
		const { dataGroupNumber, digest } = parseDgHashEntry(child);
		dgHashes.set(dataGroupNumber, digest);
	}

	const dg1Hash = dgHashes.get(1);
	const dg2Hash = dgHashes.get(2);

	if (!(dg1Hash && dg2Hash)) {
		throw new Error("required_dg_hash_missing");
	}

	return {
		dg1Hash,
		dg2Hash,
		dgHashes,
	};
}

export function parseSodSecurityObject(
	sod: Uint8Array,
): ParsedSodSecurityObject {
	ensurePkijsEngine();
	const contentInfo = parseContentInfo(sod);
	const signedData = parseSignedData(contentInfo);
	const root = parseLdsSecurityObjectRoot(signedData);
	const { hashAlgorithmNode, hashValuesNode } =
		parseLdsSecurityObjectNodes(root);
	const algorithm = parseDigestAlgorithm(hashAlgorithmNode);
	const { dg1Hash, dg2Hash, dgHashes } = parseRequiredDgHashes(hashValuesNode);

	return {
		algorithm,
		dg1Hash,
		dg2Hash,
		dgHashes,
		signedData,
	};
}
