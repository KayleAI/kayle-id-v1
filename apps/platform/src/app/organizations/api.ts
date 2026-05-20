import { client } from "@kayle-id/auth/client";
import {
	type OrganizationMetadata,
	parseStoredOrganizationMetadata,
} from "@kayle-id/auth/organization-metadata";
import type { Organization, OrganizationRole } from "@kayle-id/auth/types";
import { requestApiResource } from "@/utils/api-client";

const ORG_DELETE_BASE_PATH = "/api/auth/orgs";

export const ORGANIZATION_QUERY_KEY = ["organization"] as const;

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

export type {
	AuditLogActor,
	AuditLogEntry,
	AuditLogPage,
	AuditLogsListInput,
} from "./audit-logs-api";
export {
	listAuditLogs,
	ORGANIZATION_AUDIT_LOGS_QUERY_KEY,
} from "./audit-logs-api";
export type {
	ActiveDomainChallenge,
	DnsChallengeStarted,
	DomainVerificationMethod,
	OrganizationDomainsList,
	RedirectUri,
	RpIntegrationTermsStatus,
	VerifiedDnsChallenge,
	VerifiedDomain,
} from "./domains-api";
export {
	acceptRpIntegrationTerms,
	addRedirectUri,
	fetchRpIntegrationTermsStatus,
	listOrganizationDomains,
	listRedirectUris,
	ORGANIZATION_DOMAINS_QUERY_KEY,
	ORGANIZATION_REDIRECT_URIS_QUERY_KEY,
	ORGANIZATION_RP_TERMS_QUERY_KEY,
	removeRedirectUri,
	removeVerifiedDomain,
	startDnsDomainChallenge,
	verifyDnsDomainChallenge,
} from "./domains-api";
