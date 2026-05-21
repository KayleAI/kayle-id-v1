export type PublicOrganizationsPage = {
	has_next_page: boolean;
	has_previous_page: boolean;
	page: number;
	page_size: number;
};

export type PublicOrganizationRow = {
	businessJurisdiction: null | string;
	businessName: null | string;
	businessRegistrationNumber: null | string;
	businessType: "business" | "sole" | null;
	id: string;
	logo: null | string;
	metadata: null | string;
	name: string;
	ownerIdCheckedAt: Date | null;
	slug: string;
};
