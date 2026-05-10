import { OpenAPIHono } from "@hono/zod-openapi";
import { recordAuditLogSafe } from "@kayle-id/auth/audit-logs";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { webhook_endpoints } from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { rotateWebhookEndpointSigningSecret } from "@/openapi/v1/webhooks/endpoints/rotate-signing-secret";
import { encryptWebhookSigningSecret } from "@/v1/webhooks/signing-secret";
import { generateSigningSecret } from "./utils";

const rotateSigningSecretEndpoint = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		apiKeyId?: string;
		organizationId: string;
		type: "api" | "session";
		userId?: string;
	};
}>();

rotateSigningSecretEndpoint.openapi(
	rotateWebhookEndpointSigningSecret,
	async (c) => {
		const organizationId = c.get("organizationId");
		const userId = c.get("userId");
		const apiKeyId = c.get("apiKeyId");
		const params = c.req.valid("param");

		const [endpoint] = await db
			.select()
			.from(webhook_endpoints)
			.where(
				and(
					eq(webhook_endpoints.id, params.endpoint_id),
					eq(webhook_endpoints.organizationId, organizationId),
				),
			)
			.limit(1);

		if (!endpoint) {
			return c.json(
				{
					data: null,
					error: {
						code: "NOT_FOUND",
						message: "Webhook endpoint not found.",
						hint: "The webhook endpoint with the given ID was not found.",
						docs: "https://kayle.id/docs/api/webhooks/endpoints#rotate-signing-secret",
					},
				},
				404,
			);
		}

		const signingSecret = generateSigningSecret();
		const authSecret = c.env?.AUTH_SECRET ?? env.AUTH_SECRET;
		const signingSecretCiphertext = await encryptWebhookSigningSecret({
			plaintext: signingSecret,
			secret: authSecret,
		});

		await db
			.update(webhook_endpoints)
			.set({
				signingSecretCiphertext,
			})
			.where(eq(webhook_endpoints.id, endpoint.id));

		// See list.ts for the actor-type policy across session vs API-key callers.
		await recordAuditLogSafe({
			...(userId
				? { actorType: "user" as const, actorUserId: userId }
				: apiKeyId
					? { actorType: "api_key" as const, actorApiKeyId: apiKeyId }
					: { actorType: "system" as const }),
			organizationId,
			event: "webhook_endpoint.signing_secret.rotated",
			targetId: endpoint.id,
			targetType: "webhook_endpoint",
		});

		return c.json(
			{
				data: {
					endpoint_id: endpoint.id,
					signing_secret: signingSecret,
				},
				error: null,
			},
			200,
		);
	},
);

export { rotateSigningSecretEndpoint };
