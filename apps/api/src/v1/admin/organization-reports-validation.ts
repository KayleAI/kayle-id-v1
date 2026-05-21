import {
	ORGANIZATION_REPORT_REASONS,
	ORGANIZATION_REPORT_STATUSES,
} from "@kayle-id/config/organization-reports";
import type { Context } from "hono";
import { z } from "zod";

const REPORT_ID_PATTERN = /^orpt_[a-zA-Z0-9_-]+$/u;
const ADMIN_NOTE_MAX_LENGTH = 2000;
const REPORT_SEARCH_MAX_LENGTH = 120;

export const querySchema = z.object({
	query: z
		.string()
		.trim()
		.max(REPORT_SEARCH_MAX_LENGTH)
		.optional()
		.transform((value) => (value && value.length > 0 ? value : undefined)),
	reason: z.enum(ORGANIZATION_REPORT_REASONS).optional(),
	status: z.enum(ORGANIZATION_REPORT_STATUSES).optional(),
});

export const updateParamSchema = z.object({
	id: z.string().regex(REPORT_ID_PATTERN),
});

export const updateBodySchema = z.object({
	admin_note: z.string().max(ADMIN_NOTE_MAX_LENGTH).nullish(),
	status: z.enum(ORGANIZATION_REPORT_STATUSES),
});

export function jsonError(
	c: Context,
	{
		code,
		message,
		status,
	}: {
		code: string;
		message: string;
		status: 400 | 404;
	},
) {
	return c.json(
		{
			data: null,
			error: { code, message },
		},
		status,
	);
}
