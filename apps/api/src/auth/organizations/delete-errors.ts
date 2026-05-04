import type { OrgDeletionError } from "@kayle-id/auth/organization-deletion";

export interface DeletionErrorEnvelope {
	data: null;
	error: { code: string; message: string; hint: string; docs: string };
}

export function orgDeletionErrorBody(
	error: OrgDeletionError,
): DeletionErrorEnvelope {
	return {
		data: null,
		error: {
			code: error.code,
			message: error.message,
			hint: error.code.startsWith("CODE_")
				? "Request a new code to try again."
				: "See the docs for the recovery path for this error.",
			docs: "https://kayle.id/docs/api/errors#organization_deletion",
		},
	};
}
