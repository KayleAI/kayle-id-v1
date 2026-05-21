import type { OrgVerificationDocumentType } from "./dedup";

export type FinalizeOrgVerificationInput = {
	organizationId: string;
	documentType: OrgVerificationDocumentType;
	documentNumber: string;
	issuingCountry: string;
	ownerUserId: string;
};

export type FinalizeTarget =
	| {
			kind: "ready";
			organizationId: string;
	  }
	| {
			kind: "not_found";
	  }
	| {
			kind: "already_verified";
			organizationId: string;
			verifiedAt: Date;
	  }
	| {
			kind: "frozen";
	  };

export type FinalizeResult =
	| {
			alreadyVerified: false;
			dedupHash: string;
			kind: "verified";
			pepperVersion: number;
			recordId: string;
			verifiedAt: Date;
	  }
	| {
			alreadyVerified: true;
			kind: "already_verified";
			verifiedAt: Date;
	  }
	| {
			kind: "document_conflict";
			recordOrganizationId: string;
	  }
	| {
			kind: "frozen";
	  }
	| {
			kind: "owner_not_active";
	  };
