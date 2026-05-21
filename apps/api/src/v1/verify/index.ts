import { logEvent } from "@kayle-id/config/logging";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { getRequestLogger } from "@/logging";
import attest from "./attest-handlers";
import {
	recordVerifySessionConsent,
	type VerifyConsentInput,
} from "./consent-records";
import { issueHandoffPayload } from "./handoff";
import organizationReports from "./organization-reports";
import { getPublicVerifySessionPrivacyContext } from "./privacy-context";
import {
	cancelBodyJsonValidator,
	cancelPublicVerifySession,
} from "./public-cancel";
import publicOrganizations from "./public-organizations";
import { checkRedirectPermitted } from "./redirect-permitted";
import {
	invalidVerifyRequestJson,
	sessionParamJsonValidator,
	validateSessionParam,
	verifyJsonError,
} from "./route-utils";
import { loadActiveVerifySession } from "./session-context";
import { getPublicVerifySessionDetails } from "./session-details";
import { getPublicVerifySessionStatus } from "./session-status";
import { startVerifySocketSession } from "./socket-controller";
import { webSocketErrorResponse } from "./utils";
import { configurePkdTrustBundleLoaderFromEnv } from "./validation";

const verify = new Hono<{ Bindings: CloudflareBindings }>();

verify.route("/attest", attest);
verify.route("/", publicOrganizations);
verify.route("/", organizationReports);

const consentBodySchema = z.object({
	biometric_consent: z.literal(true),
	document_processing_consent: z.literal(true),
	privacy_notice_acknowledged: z.literal(true),
	share_claims_consent: z.literal(true),
	terms_acknowledged: z.literal(true),
});

verify.post(
	"/session/:id/consent",
	validator("param", sessionParamJsonValidator),
	validator("json", (value, c) => {
		const parsed = consentBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		return invalidVerifyRequestJson(c);
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const body = c.req.valid("json");
		const result = await recordVerifySessionConsent({
			env: c.env,
			sessionId: id,
			input: {
				biometricConsent: body.biometric_consent,
				documentProcessingConsent: body.document_processing_consent,
				privacyNoticeAcknowledged: body.privacy_notice_acknowledged,
				shareClaimsConsent: body.share_claims_consent,
				termsAcknowledged: body.terms_acknowledged,
			} satisfies VerifyConsentInput,
		});

		if (!result.ok) {
			return verifyJsonError(c, {
				code: result.error.code,
				status: result.error.status,
			});
		}

		return c.json(
			{
				data: result.data,
				error: null,
			},
			200,
		);
	},
);

verify.post(
	"/session/:id/handoff",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const startedAt = Date.now();
		const handoff = await issueHandoffPayload(id, { env: c.env });
		logEvent(getRequestLogger(c), {
			details: {
				duration_ms: Date.now() - startedAt,
				session_id: id,
				success: handoff.ok,
			},
			event: "verify.handoff.issued_timing",
		});

		if (!handoff.ok) {
			return verifyJsonError(c, {
				code: handoff.error.code,
				status: handoff.error.status,
			});
		}

		return c.json(
			{
				data: handoff.data,
				error: null,
			},
			200,
		);
	},
);

verify.get(
	"/session/:id/details",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const details = await getPublicVerifySessionDetails({
			sessionId: id,
		});

		if (!details) {
			return verifyJsonError(c, {
				code: "SESSION_NOT_FOUND",
				status: 404,
			});
		}

		return c.json(
			{
				data: details,
				error: null,
			},
			200,
		);
	},
);

verify.get(
	"/session/:id/redirect-permitted",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const result = await checkRedirectPermitted({ sessionId: id });

		if (result.code === "SESSION_NOT_FOUND") {
			return verifyJsonError(c, {
				code: "SESSION_NOT_FOUND",
				status: 404,
			});
		}

		return c.json(
			{
				data: {
					permitted: result.code !== "REDIRECT_DENIED",
					redirect_url:
						result.code === "REDIRECT_NOT_SET" ? null : result.redirect_url,
				},
				error: null,
			},
			200,
		);
	},
);

verify.get(
	"/session/:id/status",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const status = await getPublicVerifySessionStatus({
			env: c.env,
			sessionId: id,
		});

		if (!status) {
			return verifyJsonError(c, {
				code: "SESSION_NOT_FOUND",
				status: 404,
			});
		}

		return c.json(
			{
				data: status,
				error: null,
			},
			200,
		);
	},
);

verify.get(
	"/session/:id/privacy-context",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const context = await getPublicVerifySessionPrivacyContext({
			env: c.env,
			sessionId: id,
		});

		if (!context) {
			return verifyJsonError(c, {
				code: "SESSION_NOT_FOUND",
				status: 404,
			});
		}

		return c.json(
			{
				data: context,
				error: null,
			},
			200,
		);
	},
);

verify.post(
	"/session/:id/cancel",
	validator("param", sessionParamJsonValidator),
	validator("json", cancelBodyJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const { cancel_token: providedToken } = c.req.valid("json");
		const result = await cancelPublicVerifySession({
			env: c.env,
			providedToken,
			sessionId: id,
		});

		if (!result.ok) {
			return verifyJsonError(c, result.error);
		}

		return c.body(null, 204);
	},
);

verify.get(
	"/session/:id",
	validator("param", (value) => {
		const parsed = validateSessionParam(value);

		if (!parsed) {
			return webSocketErrorResponse({
				code: "INVALID_SESSION_ID",
			});
		}

		return parsed;
	}),
	async (c) => {
		configurePkdTrustBundleLoaderFromEnv(c.env);

		if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
			return c.json(
				{
					error: {
						code: "WEBSOCKET_REQUIRED",
						message: "This endpoint requires a WebSocket connection.",
					},
				},
				426,
			);
		}

		const activeSession = await loadActiveVerifySession(
			c.req.valid("param").id,
			{ env: c.env },
		);

		if (!activeSession.ok) {
			return webSocketErrorResponse({
				code: activeSession.code,
			});
		}

		return startVerifySocketSession(c, activeSession.value);
	},
);

export default verify;
