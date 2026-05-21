export type PrivacyRequestRouteContext =
	| {
			kind: "found";
			session_id: string;
			status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
			is_terminal: boolean;
			has_withdrawn_consent: boolean;
			organization_id: string;
			organization_name: string | null;
			organization_owner_id_check_completed: boolean;
			organization_verified_apex_domains: string[];
			organization_logo: string | null;
			organization_business_type: "sole" | "business" | null;
			organization_business_name: string | null;
			organization_business_jurisdiction: string | null;
			organization_business_registration_number: string | null;
			organization_privacy_policy_url: string | null;
			organization_terms_of_service_url: string | null;
			organization_website: string | null;
			organization_description: string | null;
			rp_fallback: {
				appeal_url: string | null;
				complaints_url: string | null;
				fallback_idv_url: string | null;
				support_email: string | null;
			};
			result_webhook_deliveries: {
				total_count: number;
				succeeded_count: number;
				undelivered_count: number;
			};
	  }
	| {
			kind: "not_found";
			session_id: string;
	  };
