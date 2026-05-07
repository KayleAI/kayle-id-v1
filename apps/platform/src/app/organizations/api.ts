import { client } from "@kayle-id/auth/client";
import type { Organization } from "@kayle-id/auth/types";
import { requestApiResource } from "@/utils/api-client";

const ORG_DELETE_BASE_PATH = "/api/auth/orgs";

export const ORGANIZATION_QUERY_KEY = ["organization"] as const;

export type OrganizationRole = "owner" | "admin" | "member";

export interface OrganizationMember {
	createdAt: string;
	id: string;
	organizationId: string;
	role: OrganizationRole;
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

export interface OrganizationMetadata {
	description?: string | null;
	website?: string | null;
}

export interface FullOrganization extends Organization {
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

function parseMetadata(value: unknown): OrganizationMetadata | null {
	if (value === null || value === undefined) {
		return null;
	}

	if (typeof value === "object") {
		return value as OrganizationMetadata;
	}

	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object"
			? (parsed as OrganizationMetadata)
			: null;
	} catch {
		return null;
	}
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
		metadata: parseMetadata(data.metadata),
	};
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

export async function removeOrganizationMember(input: {
	memberIdOrEmail: string;
}): Promise<void> {
	const result = (await client.organization.removeMember(
		input,
	)) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to remove member");
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

export async function leaveOrganization(organizationId: string): Promise<void> {
	const result = (await client.organization.leave({
		organizationId,
	})) as BetterAuthResult<unknown>;
	unwrap(result, "Failed to leave organization");
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

interface VerificationSessionResponse {
	expires_at: string;
	id: string;
	verification_url: string;
}

export async function createOwnerVerificationSession(input: {
	organizationId: string;
	redirectUrl: string;
}): Promise<VerificationSessionResponse> {
	return await requestApiResource<VerificationSessionResponse>({
		basePath: "/api/org-verifications",
		body: {
			organization_id: input.organizationId,
			redirect_url: input.redirectUrl,
		},
		method: "POST",
		path: "/",
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
