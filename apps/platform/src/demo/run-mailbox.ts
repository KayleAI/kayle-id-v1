import { DurableObject } from "cloudflare:workers";
import { constantTimeStringEqual } from "@kayle-id/config/constant-time";
import {
	isRequestBodyTooLarge,
	readRequestJsonWithLimit,
	readRequestTextWithLimit,
} from "@kayle-id/config/request-body";
import { disableDemoWebhookEndpoint } from "./api";
import type {
	DemoRunRecord,
	DemoSessionShareFields,
	DemoSessionStatus,
	DemoWebhookEnvelope,
} from "./types";
import { appendDemoWebhookHistory } from "./webhook-history";

const ABANDONED_RUN_RETENTION_MS = 2 * 60 * 60 * 1000;
const DEMO_MAILBOX_JSON_BODY_LIMIT_BYTES = 32 * 1024;
const DEMO_RUN_RATE_LIMIT = 100;
const DEMO_RUN_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const DEMO_WEBHOOK_BODY_LIMIT_BYTES = 256 * 1024;
const TERMINAL_RUN_RETENTION_MS = 30 * 60 * 1000;
const RATE_LIMIT_KEY = "demo-run-rate-limit";
const RECORD_KEY = "demo-run";

interface DemoRunMailboxEnv {
	API?: Fetcher;
	KAYLE_DEMO_API_KEY?: string;
	KAYLE_DEMO_ORG_SLUG?: string;
}

interface InitializePayload {
	endpoint_id: string;
	key_id: string;
	org_slug: string;
	receiver_token: string;
}

interface SessionPayload {
	session_id: string;
	share_fields: DemoSessionShareFields;
	verification_url: string;
}

interface RateLimitRecord {
	count: number;
	reset_at: number;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return Response.json(body, init);
}

function payloadTooLargeResponse(): Response {
	return jsonResponse(
		{
			data: null,
			error: {
				code: "PAYLOAD_TOO_LARGE",
				message: "Request body is too large.",
			},
		},
		{ status: 413 },
	);
}

export class DemoRunMailbox extends DurableObject<DemoRunMailboxEnv> {
	async fetch(request: Request): Promise<Response> {
		try {
			return await this.fetchWithBodyLimits(request);
		} catch (error) {
			if (isRequestBodyTooLarge(error)) {
				return payloadTooLargeResponse();
			}

			throw error;
		}
	}

	private async fetchWithBodyLimits(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const pathname = url.pathname;

		if (request.method === "POST" && pathname === "/rate-limit/demo-runs") {
			return await this.checkDemoRunRateLimit();
		}

		if (request.method === "POST" && pathname === "/initialize") {
			await this.initializeRecord(
				await readRequestJsonWithLimit<InitializePayload>(
					request,
					DEMO_MAILBOX_JSON_BODY_LIMIT_BYTES,
				),
			);
			return new Response(null, { status: 204 });
		}

		const record = await this.getRecord();
		if (!record) {
			return jsonResponse(
				{
					data: null,
					error: {
						code: "NOT_FOUND",
						message: "Demo run not found.",
					},
				},
				{ status: 404 },
			);
		}

		if (request.method === "GET" && pathname === "/state") {
			return jsonResponse({ data: record, error: null });
		}

		if (request.method === "POST" && pathname === "/session") {
			await this.persistSession(
				record,
				await readRequestJsonWithLimit<SessionPayload>(
					request,
					DEMO_MAILBOX_JSON_BODY_LIMIT_BYTES,
				),
			);
			return new Response(null, { status: 204 });
		}

		if (request.method === "POST" && pathname === "/session-status") {
			await this.persistSessionStatus(
				record,
				await readRequestJsonWithLimit<DemoSessionStatus>(
					request,
					DEMO_MAILBOX_JSON_BODY_LIMIT_BYTES,
				),
			);
			return new Response(null, { status: 204 });
		}

		if (request.method === "POST" && pathname === "/webhook") {
			const token = url.searchParams.get("token");
			if (!token || !constantTimeStringEqual(token, record.receiver_token)) {
				return jsonResponse(
					{
						data: null,
						error: {
							code: "FORBIDDEN",
							message: "Webhook token is invalid.",
						},
					},
					{ status: 403 },
				);
			}

			await this.persistWebhook(record, request);
			return new Response(null, { status: 204 });
		}

		return jsonResponse(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Demo mailbox route not found.",
				},
			},
			{ status: 404 },
		);
	}

	async alarm(): Promise<void> {
		const record = await this.getRecord();
		if (!record) {
			await this.ctx.storage.deleteAll();
			return;
		}

		try {
			await disableDemoWebhookEndpoint({
				bindings: this.env,
				endpointId: record.endpoint_id,
			});
		} catch {
			// The demo mailbox is ephemeral; failed cleanup should not keep the state alive.
		}

		await this.ctx.storage.deleteAll();
	}

	private async checkDemoRunRateLimit(): Promise<Response> {
		const now = Date.now();
		const existing =
			(await this.ctx.storage.get<RateLimitRecord>(RATE_LIMIT_KEY)) ?? null;
		const resetAt =
			existing && existing.reset_at > now
				? existing.reset_at
				: now + DEMO_RUN_RATE_LIMIT_WINDOW_MS;
		const count = existing && existing.reset_at > now ? existing.count : 0;

		if (count >= DEMO_RUN_RATE_LIMIT) {
			const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

			return jsonResponse(
				{
					data: null,
					error: {
						code: "RATE_LIMITED",
						message: "Too many demo runs were created. Try again later.",
					},
				},
				{
					headers: {
						"Retry-After": String(retryAfterSeconds),
					},
					status: 429,
				},
			);
		}

		await this.ctx.storage.put(RATE_LIMIT_KEY, {
			count: count + 1,
			reset_at: resetAt,
		} satisfies RateLimitRecord);
		await this.ctx.storage.setAlarm(resetAt);

		return new Response(null, { status: 204 });
	}

	private async getRecord(): Promise<DemoRunRecord | null> {
		return (await this.ctx.storage.get<DemoRunRecord>(RECORD_KEY)) ?? null;
	}

	private async initializeRecord(payload: InitializePayload): Promise<void> {
		const record: DemoRunRecord = {
			created_at: new Date().toISOString(),
			endpoint_id: payload.endpoint_id,
			key_id: payload.key_id,
			last_session_status: null,
			org_slug: payload.org_slug,
			receiver_token: payload.receiver_token,
			session_id: null,
			share_fields: null,
			verification_url: null,
			webhook: null,
			webhooks: [],
		};

		await this.ctx.storage.put(RECORD_KEY, record);
		await this.ctx.storage.setAlarm(Date.now() + ABANDONED_RUN_RETENTION_MS);
	}

	private async persistSession(
		record: DemoRunRecord,
		payload: SessionPayload,
	): Promise<void> {
		await this.ctx.storage.put(RECORD_KEY, {
			...record,
			session_id: payload.session_id,
			share_fields: payload.share_fields,
			verification_url: payload.verification_url,
		});
	}

	private async persistSessionStatus(
		record: DemoRunRecord,
		sessionStatus: DemoSessionStatus,
	): Promise<void> {
		await this.ctx.storage.put(RECORD_KEY, {
			...record,
			last_session_status: sessionStatus,
		});

		if (sessionStatus.is_terminal) {
			await this.ctx.storage.setAlarm(Date.now() + TERMINAL_RUN_RETENTION_MS);
		}
	}

	private async persistWebhook(
		record: DemoRunRecord,
		request: Request,
	): Promise<void> {
		const envelope: DemoWebhookEnvelope = {
			body: await readRequestTextWithLimit(
				request,
				DEMO_WEBHOOK_BODY_LIMIT_BYTES,
			),
			delivery_id: request.headers.get("X-Kayle-Delivery-Id"),
			event_type: request.headers.get(
				"X-Kayle-Event",
			) as DemoWebhookEnvelope["event_type"],
			received_at: new Date().toISOString(),
			signature_header: request.headers.get("X-Kayle-Signature"),
		};

		await this.ctx.storage.put(RECORD_KEY, {
			...record,
			webhook: envelope,
			webhooks: appendDemoWebhookHistory(record, envelope),
		});
		await this.ctx.storage.setAlarm(Date.now() + TERMINAL_RUN_RETENTION_MS);
	}
}
