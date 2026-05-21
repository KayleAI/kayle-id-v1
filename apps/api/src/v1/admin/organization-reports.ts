import type { OrganizationReportStatus } from "@kayle-id/config/organization-reports";
import { Hono } from "hono";
import { validator } from "hono/validator";
import {
	listOrganizationReports,
	selectReportById,
	serializeReport,
	updateOrganizationReport,
} from "./organization-reports-repository";
import {
	jsonError,
	querySchema,
	updateBodySchema,
	updateParamSchema,
} from "./organization-reports-validation";

type AdminContextVariables = {
	userId: string;
	organizationId: string;
};

const organizationReports = new Hono<{
	Bindings: CloudflareBindings;
	Variables: AdminContextVariables;
}>();

organizationReports.get("/organization-reports", async (c) => {
	const parsed = querySchema.safeParse({
		query: c.req.query("query"),
		reason: c.req.query("reason"),
		status: c.req.query("status"),
	});
	if (!parsed.success) {
		return jsonError(c, {
			code: "INVALID_QUERY",
			message: parsed.error.issues[0]?.message ?? "Invalid query.",
			status: 400,
		});
	}

	const rows = await listOrganizationReports(parsed.data);

	return c.json({
		data: { reports: rows.map(serializeReport) },
		error: null,
	});
});

organizationReports.get(
	"/organization-reports/:id",
	validator("param", (value, c) => {
		const parsed = updateParamSchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REPORT_ID",
			message: "Invalid report ID.",
			status: 400,
		});
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const report = await selectReportById(id);

		if (!report) {
			return jsonError(c, {
				code: "REPORT_NOT_FOUND",
				message: "The organization report could not be found.",
				status: 404,
			});
		}

		return c.json({
			data: { report: serializeReport(report) },
			error: null,
		});
	},
);

organizationReports.patch(
	"/organization-reports/:id",
	validator("param", (value, c) => {
		const parsed = updateParamSchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REPORT_ID",
			message: "Invalid report ID.",
			status: 400,
		});
	}),
	validator("json", (value, c) => {
		const parsed = updateBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return jsonError(c, {
			code: "INVALID_REQUEST",
			message: parsed.error.issues[0]?.message ?? "Invalid update request.",
			status: 400,
		});
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const nextStatus = body.status as OrganizationReportStatus;
		const report = await updateOrganizationReport({
			adminNote: body.admin_note,
			id,
			status: nextStatus,
			userId: c.get("userId"),
		});
		if (!report) {
			return jsonError(c, {
				code: "REPORT_NOT_FOUND",
				message: "The organization report could not be found.",
				status: 404,
			});
		}

		return c.json({
			data: { report: serializeReport(report) },
			error: null,
		});
	},
);

export default organizationReports;
