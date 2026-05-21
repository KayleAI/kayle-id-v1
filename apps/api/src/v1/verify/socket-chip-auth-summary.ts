import { parseDg14 } from "./dg14-parser";

export type Dg14ChipAuthSummary = {
	declaration: "none" | "v1_only" | "v2";
	chipAuthInfoCount: number;
	chipAuthInfoVersions: number[];
	chipAuthInfoOids: string[];
	chipAuthPublicKeyCount: number;
	chipAuthPublicKeyOids: string[];
};

const EMPTY_DG14_CHIP_AUTH_SUMMARY: Dg14ChipAuthSummary = {
	declaration: "none",
	chipAuthInfoCount: 0,
	chipAuthInfoVersions: [],
	chipAuthInfoOids: [],
	chipAuthPublicKeyCount: 0,
	chipAuthPublicKeyOids: [],
};

export function summarizeDg14ChipAuth(
	dg14: Uint8Array | undefined,
): Dg14ChipAuthSummary {
	if (!dg14 || dg14.length === 0) {
		return EMPTY_DG14_CHIP_AUTH_SUMMARY;
	}

	try {
		const parsed = parseDg14(dg14);
		const infos = parsed.chipAuthInfos;
		const declaration: Dg14ChipAuthSummary["declaration"] =
			infos.length === 0
				? "none"
				: infos.some((info) => info.version >= 2)
					? "v2"
					: "v1_only";

		return {
			declaration,
			chipAuthInfoCount: infos.length,
			chipAuthInfoVersions: infos.map((info) => info.version),
			chipAuthInfoOids: infos.map((info) => info.algorithm.oid),
			chipAuthPublicKeyCount: parsed.chipAuthPublicKeys.length,
			chipAuthPublicKeyOids: parsed.chipAuthPublicKeys.map(
				(entry) => entry.algorithmOid,
			),
		};
	} catch {
		return EMPTY_DG14_CHIP_AUTH_SUMMARY;
	}
}

export function chipAuthSummaryDetails(summary: Dg14ChipAuthSummary) {
	return {
		dg14_chip_auth_declaration: summary.declaration,
		dg14_chip_auth_info_count: summary.chipAuthInfoCount,
		dg14_chip_auth_info_oids: summary.chipAuthInfoOids,
		dg14_chip_auth_info_versions: summary.chipAuthInfoVersions,
		dg14_chip_auth_public_key_count: summary.chipAuthPublicKeyCount,
		dg14_chip_auth_public_key_oids: summary.chipAuthPublicKeyOids,
	};
}
