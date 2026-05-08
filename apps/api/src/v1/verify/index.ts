import { db } from "@kayle-id/database/drizzle";
import { verification_sessions } from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { validator } from "hono/validator";
import { z } from "zod";
import { sessionIdSchema } from "@/shared/validation";
import {
	cancelVerificationSession,
	expireVerificationSessionIfNeeded,
} from "@/v1/sessions/repo/session-repo";
import attest from "./attest-handlers";
import { createVerifyJsonErrorResponse } from "./error-response";
import { issueHandoffPayload } from "./handoff";
import { loadActiveVerifySession } from "./session-context";
import { getPublicVerifySessionDetails } from "./session-details";
import { getPublicVerifySessionStatus } from "./session-status";
import { startVerifySocketSession } from "./socket-controller";
import { hashSessionCancelToken } from "./token-crypto";
import { webSocketErrorResponse } from "./utils";
import { configurePkdTrustBundleLoaderFromEnv } from "./validation";

const verify = new Hono<{ Bindings: CloudflareBindings }>();
const sessionParamSchema = z.object({ id: sessionIdSchema });

verify.route("/attest", attest);

function validateSessionParam(
	value: unknown,
): z.infer<typeof sessionParamSchema> | null {
	const parsed = sessionParamSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

function sessionParamJsonValidator(value: unknown, c: Context) {
	const parsed = validateSessionParam(value);

	if (parsed) {
		return parsed;
	}

	const response = createVerifyJsonErrorResponse({
		code: "INVALID_SESSION_ID",
		status: 400,
	});

	return c.json(
		{
			data: response.data,
			error: response.error,
		},
		response.status,
	);
}

verify.post(
	"/session/:id/handoff",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const handoff = await issueHandoffPayload(id, { env: c.env });

		if (!handoff.ok) {
			const response = createVerifyJsonErrorResponse({
				code: handoff.error.code,
				status: handoff.error.status,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
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
			const response = createVerifyJsonErrorResponse({
				code: "SESSION_NOT_FOUND",
				status: 404,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
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
	"/session/:id/status",
	validator("param", sessionParamJsonValidator),
	async (c) => {
		const { id } = c.req.valid("param");
		const status = await getPublicVerifySessionStatus({
			env: c.env,
			sessionId: id,
		});

		if (!status) {
			const response = createVerifyJsonErrorResponse({
				code: "SESSION_NOT_FOUND",
				status: 404,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
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

const cancelBodySchema = z.object({
	cancel_token: z.string().min(1),
});

function constantTimeStringEqual(a: string, b: string): boolean {
	if (a.length !== b.length) {
		return false;
	}

	let mismatch = 0;
	for (let index = 0; index < a.length; index++) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}

verify.post(
	"/session/:id/cancel",
	validator("param", sessionParamJsonValidator),
	validator("json", (value, c) => {
		const parsed = cancelBodySchema.safeParse(value);
		if (parsed.success) {
			return parsed.data;
		}

		const response = createVerifyJsonErrorResponse({
			code: "INVALID_REQUEST",
			status: 400,
		});

		return c.json(
			{
				data: response.data,
				error: response.error,
			},
			response.status,
		);
	}),
	async (c) => {
		const { id } = c.req.valid("param");
		const { cancel_token: providedToken } = c.req.valid("json");

		const [rawSession] = await db
			.select()
			.from(verification_sessions)
			.where(eq(verification_sessions.id, id))
			.limit(1);

		if (!rawSession) {
			const response = createVerifyJsonErrorResponse({
				code: "SESSION_NOT_FOUND",
				status: 404,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
		}

		// Reject sessions that pre-date the cancel-token migration: nothing to
		// authenticate against, so the public cancel surface refuses the request.
		// The integrator can still cancel via the authenticated `/v1/sessions/:id
		// /cancel` endpoint (which checks org ownership instead).
		if (!rawSession.cancelTokenHash) {
			const response = createVerifyJsonErrorResponse({
				code: "CANCEL_TOKEN_INVALID",
				status: 401,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
		}

		const providedTokenHash = await hashSessionCancelToken(providedToken);
		if (
			!constantTimeStringEqual(providedTokenHash, rawSession.cancelTokenHash)
		) {
			const response = createVerifyJsonErrorResponse({
				code: "CANCEL_TOKEN_INVALID",
				status: 401,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
		}

		const session = await expireVerificationSessionIfNeeded({
			env: c.env,
			row: rawSession,
		});

		// Idempotency: if cancel was already consumed and the session is in a
		// terminal state, return the same 204 we'd return on first success so
		// the verify browser doesn't surface a confusing error after retry.
		const isTerminal = ["completed", "expired", "cancelled"].includes(
			session.status,
		);

		if (rawSession.cancelTokenConsumedAt) {
			if (isTerminal) {
				return c.body(null, 204);
			}

			const response = createVerifyJsonErrorResponse({
				code: "CANCEL_TOKEN_USED",
				status: 401,
			});

			return c.json(
				{
					data: response.data,
					error: response.error,
				},
				response.status,
			);
		}

		await db
			.update(verification_sessions)
			.set({ cancelTokenConsumedAt: new Date() })
			.where(eq(verification_sessions.id, session.id));

		if (!isTerminal) {
			await cancelVerificationSession({
				env: c.env,
				row: session,
				organizationId: session.organizationId,
			});
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
