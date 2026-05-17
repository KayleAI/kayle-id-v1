import { client } from "@kayle-id/auth/client";
import {
	type OrganizationMetadata,
	parseStoredOrganizationMetadata,
} from "@kayle-id/auth/organization-metadata";
import type { Organization } from "@kayle-id/auth/types";
import {
	type Pagination,
	requestApiResource,
	requestApiResourcePage,
} from "@/utils/api-client";

const ORG_DELETE_BASE_PATH = "/api/auth/orgs";

export const ORGANIZATION_QUERY_KEY = ["organization"] as const;

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationMember {
	createdAt: string;
	id: string;
	organizationId: string;
	role: OrganizationRole;
	/**
	 * ISO 8601 timestamp set when the membership has been suspended. Suspended
	 * rows are kept for audit-log attribution but the user has no access to
	 * the organization. `null` means the membership is active.
	 */
	suspendedAt: string | null;
	suspendedBy: string | null;
	user: {
		email: string;
		id: string;
		image?: string | null;
		name: string;
	};
	userId: string;
}

export type OrganizationInvitationStatus =
	| "pending"
	| "accepted"
	| "rejected"
	| "canceled";

export interface OrganizationInvitation {
	email: string;
	expiresAt: string;
	id: string;
	inviterId: string;
	organizationId: string;
	role: OrganizationRole | null;
	status: OrganizationInvitationStatus;
}

export type OrganizationBusinessType = "sole" | "business";

export interface FullOrganization extends Organization {
	businessType: OrganizationBusinessType | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
	createdAt: string;
	invitations: OrganizationInvitation[];
	members: OrganizationMember[];
	metadata: OrganizationMetadata | null;
}

interface BetterAuthResult<T> {
	data: T | null;
	error: { code?: string; message?: string; status?: number } | null;
}

function unwrap<T>(result: BetterAuthResult<T>, fallback: string): T {
	if (result.error || result.data === null || result.data === undefined) {
		throw new Error(result.error?.message ?? fallback);
	}
	return result.data;
}

function toIsoStringOrNull(value: unknown): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	return null;
}

export async function fetchFullOrganization(): Promise<FullOrganization> {
	const result =
		(await client.organization.getFullOrganization()) as BetterAuthResult<
			Record<string, unknown>
		>;
	const data = unwrap(result, "Failed to load organization details");

	return {
		...(data as unknown as Organization),
		pendingDeletionAt: toIsoStringOrNull(data.pendingDeletionAt),
		pendingDeletionRequestedAt: toIsoStringOrNull(
			data.pendingDeletionRequestedAt,
		),
		pendingDeletionRequestedBy:
			typeof data.pendingDeletionRequestedBy === "string"
				? data.pendingDeletionRequestedBy
				: null,
		verifiedAt: toIsoStringOrNull(data.verifiedAt),
		verificationTermsAcceptedAt: toIsoStringOrNull(
			data.verificationTermsAcceptedAt,
		),
		verificationTermsAcceptedBy:
			typeof data.verificationTermsAcceptedBy === "string"
				? data.verificationTermsAcceptedBy
				: null,
		createdAt:
			typeof data.createdAt === "string"
				? data.createdAt
				: new Date(
						(data.createdAt as Date | undefined) ?? Date.now(),
					).toISOString(),
		invitations:
			(data.invitations as OrganizationInvitation[] | undefined) ?? [],
		members: (data.members as OrganizationMember[] | undefined) ?? [],
		metadata: parseStoredOrganizationMetadata(data.metadata),
		businessType:
			data.businessType === "sole" || data.businessType === "business"
				? data.businessType
				: null,
		businessName:
			typeof data.businessName === "string" ? data.businessName : null,
		businessJurisdiction:
			typeof data.businessJurisdiction === "string"
				? data.businessJurisdiction
				: null,
		businessRegistrationNumber:
			typeof data.businessRegistrationNumber === "string"
				? data.businessRegistrationNumber
				: null,
	};
}

export interface UpdateBusinessDetailsInput {
	businessType?: OrganizationBusinessType | null;
	businessName?: string | null;
	businessJurisdiction?: string | null;
	businessRegistrationNumber?: string | null;
}

export interface BusinessDetailsResponse {
	businessType: OrganizationBusinessType | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
}

export async function updateOrganizationBusinessDetails(
	input: UpdateBusinessDetailsInput,
): Promise<BusinessDetailsResponse> {
	return await requestApiResource<BusinessDetailsResponse>({
		basePath: ORG_DELETE_BASE_PATH,
		body: {
			...(input.businessType !== undefined
				? { business_type: input.businessType }
				: {}),
			...(input.businessName !== undefined
				? { business_name: input.businessName }
				: {}),
			...(input.businessJurisdiction !== undefined
				? { business_jurisdiction: input.businessJurisdiction }
				: {}),
			...(input.businessRegistrationNumber !== undefined
				? { business_registration_number: input.businessRegistrationNumber }
				: {}),
		},
		method: "POST",
		path: "/business-details",
		unexpectedMessage: "Failed to update business details.",
	});
}

interface UpdateOrganizationInput {
	logo?: string;
	metadata?: OrganizationMetadata;
	name?: string;
	slug?: string;
}

export async function updateOrganization(
	organizationId: string,
	input: UpdateOrganizationInput,
): Promise<void> {
	const result = (await client.organization.update({
		data: input as { logo?: string; metadata?: Record<string, unknown> },
		organizationId,
	})) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to update organization");
}

export async function inviteOrganizationMember(input: {
	email: string;
	role: OrganizationRole;
}): Promise<void> {
	const result = (await client.organization.inviteMember(
		input,
	)) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to invite member");
}

export async function cancelOrganizationInvitation(
	invitationId: string,
): Promise<void> {
	const result = (await client.organization.cancelInvitation({
		invitationId,
	})) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to cancel invitation");
}

/**
 * Suspend a member of the active organization. The membership row is kept
 * (so audit-log entries continue attributing past actions to the user) but
 * the user loses all access to the org. Replaces the previous "remove member"
 * flow — direct hard-delete via better-auth is now blocked at the API edge.
 */
export async function suspendOrganizationMember(input: {
	memberId: string;
}): Promise<void> {
	const response = await fetch(`/api/auth/orgs/members/${input.memberId}`, {
		credentials: "include",
		method: "DELETE",
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(body || "Failed to suspend member.");
	}
}

export async function reinstateOrganizationMember(input: {
	memberId: string;
}): Promise<void> {
	const response = await fetch(
		`/api/auth/orgs/members/${input.memberId}/reinstate`,
		{
			credentials: "include",
			method: "POST",
		},
	);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(body || "Failed to reinstate member.");
	}
}

export async function updateOrganizationMemberRole(input: {
	memberId: string;
	role: OrganizationRole;
}): Promise<void> {
	const result = (await client.organization.updateMemberRole(
		input,
	)) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to update member role");
}

/**
 * Leave the active organization. The caller's membership is suspended, not
 * deleted, so audit-log attribution is preserved. The last active owner
 * cannot leave.
 *
 * The `_organizationId` argument is kept for call-site parity with the
 * previous better-auth-backed implementation; the server reads the active
 * organization off the session.
 */
export async function leaveOrganization(
	_organizationId: string,
): Promise<void> {
	const response = await fetch("/api/auth/orgs/members/leave", {
		credentials: "include",
		method: "POST",
	});
	if (!response.ok) {
		const body = await response.text();
		throw new Error(body || "Failed to leave organization.");
	}
}

export async function requestOrganizationDeletion(
	organizationId: string,
): Promise<{ sentToEmail: string }> {
	return await requestApiResource<{ sentToEmail: string }>({
		basePath: ORG_DELETE_BASE_PATH,
		body: { organizationId },
		method: "POST",
		path: "/request-delete",
		unexpectedMessage: "Failed to send confirmation code.",
	});
}

export async function confirmOrganizationDeletion(
	organizationId: string,
	code: string,
): Promise<{ pendingDeletionAt: string }> {
	return await requestApiResource<{ pendingDeletionAt: string }>({
		basePath: ORG_DELETE_BASE_PATH,
		body: { organizationId, code },
		method: "POST",
		path: "/confirm-delete",
		unexpectedMessage: "Failed to confirm deletion.",
	});
}

export async function cancelOrganizationDeletion(
	organizationId: string,
): Promise<void> {
	await requestApiResource<{ ok: true }>({
		basePath: ORG_DELETE_BASE_PATH,
		body: { organizationId },
		method: "POST",
		path: "/cancel-delete",
		unexpectedMessage: "Failed to cancel deletion.",
	});
}

export async function acceptVerificationTerms(organizationId: string): Promise<{
	verificationTermsAcceptedAt: string;
	verificationTermsAcceptedBy: string;
}> {
	return await requestApiResource<{
		verificationTermsAcceptedAt: string;
		verificationTermsAcceptedBy: string;
	}>({
		basePath: ORG_DELETE_BASE_PATH,
		body: { organizationId },
		method: "POST",
		path: "/accept-verification-terms",
		unexpectedMessage: "Failed to record verification terms acceptance.",
	});
}

interface StartOrgVerificationResponse {
	session_id: string;
	verification_url: string;
}

export async function createOwnerVerificationSession(input: {
	organizationId: string;
}): Promise<StartOrgVerificationResponse> {
	return await requestApiResource<StartOrgVerificationResponse>({
		basePath: "/api",
		body: { organizationId: input.organizationId },
		method: "POST",
		path: "/start-org-verification",
		unexpectedMessage: "Failed to start owner verification.",
	});
}

interface UploadLogoInput {
	contentType: string;
	data: string;
}

export async function uploadOrganizationLogo({
	contentType,
	data,
}: UploadLogoInput): Promise<{ logo: string }> {
	return requestApiResource<{ logo: string }>({
		basePath: "/api/auth/orgs",
		body: { logo: { contentType, data } },
		method: "POST",
		path: "/logo",
		unexpectedMessage: "Failed to upload organization logo",
	});
}

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
		unexpectedMessage: "Failed to load RP integration terms status.",
	});
}

export async function acceptRpIntegrationTerms(): Promise<RpIntegrationTermsStatus> {
	return await requestApiResource<RpIntegrationTermsStatus>({
		basePath: ORG_DOMAINS_BASE_PATH,
		method: "POST",
		path: "/rp-terms",
		unexpectedMessage: "Failed to accept RP integration terms.",
	});
}

const ORG_AUDIT_LOGS_BASE_PATH = "/api/auth/orgs";
export const ORGANIZATION_AUDIT_LOGS_QUERY_KEY = [
	"organization",
	"audit-logs",
] as const;

export interface AuditLogActor {
	id: string | null;
	type: "user" | "system" | "api_key";
	name: string | null;
	email: string | null;
	apiKeyId: string | null;
	apiKeyName: string | null;
}

export interface AuditLogEntry {
	id: string;
	event: string;
	actor: AuditLogActor;
	targetId: string | null;
	targetType: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface AuditLogPage {
	data: AuditLogEntry[];
	pagination: Pagination;
}

export interface AuditLogsListInput {
	actorApiKeyId?: string;
	actorType?: "user" | "system" | "api_key";
	actorUserId?: string;
	createdFrom?: string;
	createdTo?: string;
	/**
	 * One or more event names to include. Pass an array to filter on multiple
	 * event types — the wire format is a comma-separated list. An empty array
	 * is treated the same as omitting the filter.
	 */
	events?: readonly string[];
	limit?: number;
	q?: string;
	startingAfter?: string;
}

export async function listAuditLogs(
	input?: AuditLogsListInput,
): Promise<AuditLogPage> {
	const eventParam =
		input?.events && input.events.length > 0
			? input.events.join(",")
			: undefined;
	const result = await requestApiResourcePage<AuditLogEntry>({
		basePath: ORG_AUDIT_LOGS_BASE_PATH,
		method: "GET",
		path: "/audit-logs",
		query: {
			actor_api_key_id: input?.actorApiKeyId,
			actor_type: input?.actorType,
			actor_user_id: input?.actorUserId,
			created_from: input?.createdFrom,
			created_to: input?.createdTo,
			event: eventParam,
			limit: input?.limit,
			q: input?.q,
			starting_after: input?.startingAfter,
		},
		unexpectedMessage: "Failed to load audit logs.",
	});
	return result;
}
