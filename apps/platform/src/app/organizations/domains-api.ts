import { requestApiResource } from "@/utils/api-client";

const ORG_DOMAINS_BASE_PATH = "/api/auth/orgs";

export const ORGANIZATION_DOMAINS_QUERY_KEY = [
	"organization",
	"domains",
] as const;
export const ORGANIZATION_REDIRECT_URIS_QUERY_KEY = [
	"organization",
	"redirect-uris",
] as const;
export const ORGANIZATION_RP_TERMS_QUERY_KEY = [
	"organization",
	"rp-terms",
] as const;

export type DomainVerificationMethod = "dns_txt";

export interface VerifiedDomain {
	id: string;
	apexDomain: string;
	verifiedAt: string;
	verifiedVia: DomainVerificationMethod;
	lastCheckedAt: string | null;
	downgradedAt: string | null;
}

export interface ActiveDomainChallenge {
	id: string;
	apexDomain: string;
	method: DomainVerificationMethod;
	expiresAt: string;
	createdAt: string;
}

export interface OrganizationDomainsList {
	domains: VerifiedDomain[];
	challenges: ActiveDomainChallenge[];
}

export async function listOrganizationDomains(): Promise<OrganizationDomainsList> {
	return await requestApiResource<OrganizationDomainsList>({
		basePath: ORG_DOMAINS_BASE_PATH,
		method: "GET",
		path: "/domains",
		unexpectedMessage: "Failed to load verified domains.",
	});
}

export interface DnsChallengeStarted {
	challenge_id: string;
	record_name: string;
	record_value: string;
	expires_at: string;
	conflict: { organization_name: string } | null;
}

export async function startDnsDomainChallenge(input: {
	apexDomain: string;
}): Promise<DnsChallengeStarted> {
	return await requestApiResource<DnsChallengeStarted>({
		basePath: ORG_DOMAINS_BASE_PATH,
		body: { apex_domain: input.apexDomain },
		method: "POST",
		path: "/domains/challenges/dns",
		unexpectedMessage: "Failed to start DNS challenge.",
	});
}

export interface VerifiedDnsChallenge {
	domain_id: string;
	apex_domain: string;
	takeover_from: { organization_id: string; organization_name: string } | null;
}

export async function verifyDnsDomainChallenge(input: {
	challengeId: string;
	acknowledgeTakeover?: boolean;
}): Promise<VerifiedDnsChallenge> {
	return await requestApiResource<VerifiedDnsChallenge>({
		basePath: ORG_DOMAINS_BASE_PATH,
		body: {
			challenge_id: input.challengeId,
			...(input.acknowledgeTakeover ? { acknowledge_takeover: true } : {}),
		},
		method: "POST",
		path: "/domains/challenges/dns/verify",
		unexpectedMessage: "Failed to verify DNS challenge.",
	});
}

export async function removeVerifiedDomain(input: {
	id: string;
}): Promise<void> {
	const response = await fetch(`${ORG_DOMAINS_BASE_PATH}/domains/${input.id}`, {
		credentials: "include",
		method: "DELETE",
	});
	if (response.status !== 204 && !response.ok) {
		const body = await response.text();
		throw new Error(body || "Failed to remove verified domain.");
	}
}

export interface RedirectUri {
	id: string;
	verifiedDomainId: string;
	apexDomain: string;
	pattern: string;
	createdAt: string;
}

export async function listRedirectUris(): Promise<RedirectUri[]> {
	return await requestApiResource<RedirectUri[]>({
		basePath: ORG_DOMAINS_BASE_PATH,
		method: "GET",
		path: "/redirect-uris",
		unexpectedMessage: "Failed to load redirect URIs.",
	});
}

export async function addRedirectUri(input: {
	pattern: string;
}): Promise<RedirectUri> {
	return await requestApiResource<RedirectUri>({
		basePath: ORG_DOMAINS_BASE_PATH,
		body: { pattern: input.pattern },
		method: "POST",
		path: "/redirect-uris",
		unexpectedMessage: "Failed to register redirect URI.",
	});
}

export async function removeRedirectUri(input: { id: string }): Promise<void> {
	const response = await fetch(
		`${ORG_DOMAINS_BASE_PATH}/redirect-uris/${input.id}`,
		{
			credentials: "include",
			method: "DELETE",
		},
	);
	if (response.status !== 204 && !response.ok) {
		const body = await response.text();
		throw new Error(body || "Failed to remove redirect URI.");
	}
}

export interface RpIntegrationTermsStatus {
	acceptance: {
		accepted_at: string;
		accepted_by: string | null;
		jurisdiction: string;
		terms_hash: string;
		terms_version: string;
	} | null;
	current: {
		jurisdiction: string;
		terms_hash: string;
		terms_version: string;
	};
	current_accepted: boolean;
}

export async function fetchRpIntegrationTermsStatus(): Promise<RpIntegrationTermsStatus> {
	return await requestApiResource<RpIntegrationTermsStatus>({
		basePath: ORG_DOMAINS_BASE_PATH,
		method: "GET",
		path: "/rp-terms",
		unexpectedMessage: "Failed to load Kayle ID Integration Terms status.",
	});
}

export async function acceptRpIntegrationTerms(): Promise<RpIntegrationTermsStatus> {
	return await requestApiResource<RpIntegrationTermsStatus>({
		basePath: ORG_DOMAINS_BASE_PATH,
		method: "POST",
		path: "/rp-terms",
		unexpectedMessage: "Failed to accept Kayle ID Integration Terms.",
	});
}
