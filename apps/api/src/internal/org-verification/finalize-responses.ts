import type { Context } from "hono";
import { ORG_VERIFICATION_DOCS } from "./finalize-route";
import type { FinalizeResult } from "./finalize-types";

type FinalizeCtx = Context<{ Bindings: CloudflareBindings }>;

export function organizationNotFoundResponse(c: FinalizeCtx) {
	return c.json(
		{
			data: null,
			error: {
				code: "ORGANIZATION_NOT_FOUND" as const,
				message: "Organization not found.",
				hint: "Provide an existing organization ID.",
				docs: ORG_VERIFICATION_DOCS,
			},
		},
		404,
	);
}

export function alreadyVerifiedResponse(c: FinalizeCtx, verifiedAt: Date) {
	return c.json(
		{
			data: {
				verified_at: verifiedAt.toISOString(),
				record_id: null,
				dedup_hash: null,
				pepper_version: null,
				already_verified: true,
			},
			error: null,
		},
		200,
	);
}

export function frozenOrganizationResponse(c: FinalizeCtx) {
	return c.json(
		{
			data: null,
			error: {
				code: "ORGANIZATION_FROZEN" as const,
				message:
					"Organization is scheduled for deletion. Cancel the deletion before finalizing verification.",
				hint: "Cancel the pending deletion and retry the organization verification flow.",
				docs: ORG_VERIFICATION_DOCS,
			},
		},
		410,
	);
}

export function ownerNotActiveResponse(c: FinalizeCtx) {
	return c.json(
		{
			data: null,
			error: {
				code: "OWNER_NOT_ACTIVE" as const,
				message:
					"The user who started verification is no longer an owner of this organization.",
				hint: "Start a new verification flow as a current organization owner.",
				docs: ORG_VERIFICATION_DOCS,
			},
		},
		403,
	);
}

export function documentConflictResponse(c: FinalizeCtx) {
	return c.json(
		{
			data: null,
			error: {
				code: "DOCUMENT_ALREADY_USED" as const,
				message:
					"This document has already been used to verify another organization.",
				hint: "Use a different eligible identity document for this organization.",
				docs: ORG_VERIFICATION_DOCS,
			},
		},
		409,
	);
}

export function internalServerErrorResponse(c: FinalizeCtx) {
	return c.json(
		{
			data: null,
			error: {
				code: "INTERNAL_SERVER_ERROR" as const,
				message: "Internal server error." as const,
				hint: "The server encountered an error." as const,
				docs: "https://kayle.id/docs/api/errors" as const,
			},
		},
		500,
	);
}

export function verifiedResponse(
	c: FinalizeCtx,
	result: Extract<FinalizeResult, { kind: "verified" }>,
) {
	return c.json(
		{
			data: {
				verified_at: result.verifiedAt.toISOString(),
				record_id: result.recordId,
				dedup_hash: result.dedupHash,
				pepper_version: result.pepperVersion,
				already_verified: false,
			},
			error: null,
		},
		200,
	);
}
