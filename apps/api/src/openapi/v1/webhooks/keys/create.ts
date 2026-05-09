import { createRoute, z } from "@hono/zod-openapi";
import { ErrorResponse } from "@/openapi/base";
import { InternalServerErrorResponse } from "@/openapi/errors";
import {
	WebhookEncryptionKey,
	WebhookResourceIdParam,
} from "@/openapi/models/webhook";

const WEBHOOK_ENCRYPTION_KEY_ID_MAX_LENGTH = 128;
const WEBHOOK_JWK_KEY_MAX_LENGTH = 32;
const WEBHOOK_JWK_STRING_MAX_LENGTH = 8192;
const WEBHOOK_JWK_ARRAY_MAX_LENGTH = 8;
const WEBHOOK_JWK_ARRAY_STRING_MAX_LENGTH = 64;

const WebhookJwkExtraValue = z.union([
	z.string().max(WEBHOOK_JWK_STRING_MAX_LENGTH),
	z.boolean(),
	z.number().finite(),
	z
		.array(z.string().max(WEBHOOK_JWK_ARRAY_STRING_MAX_LENGTH))
		.max(WEBHOOK_JWK_ARRAY_MAX_LENGTH),
]);

const WebhookPublicJwkRequest = z
	.object({
		kty: z.literal("RSA").optional(),
		n: z.string().min(1).max(WEBHOOK_JWK_STRING_MAX_LENGTH).optional(),
		e: z.string().min(1).max(WEBHOOK_JWK_ARRAY_STRING_MAX_LENGTH).optional(),
		alg: z.string().max(WEBHOOK_JWK_ARRAY_STRING_MAX_LENGTH).optional(),
		use: z.string().max(WEBHOOK_JWK_KEY_MAX_LENGTH).optional(),
		key_ops: z
			.array(z.string().max(WEBHOOK_JWK_ARRAY_STRING_MAX_LENGTH))
			.max(WEBHOOK_JWK_ARRAY_MAX_LENGTH)
			.optional(),
	})
	.catchall(WebhookJwkExtraValue);

export const createWebhookEncryptionKey = createRoute({
	method: "post",
	path: "/:endpoint_id/keys",
	request: {
		params: z.object({
			endpoint_id: WebhookResourceIdParam.describe(
				"The ID of the webhook endpoint to create the encryption key for (e.g. whe_...).",
			),
		}),
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							key_id: z
								.string()
								.min(1)
								.max(WEBHOOK_ENCRYPTION_KEY_ID_MAX_LENGTH)
								.describe(
									"The key identifier to use as `kid` in the JWE header.",
								),
							jwk: WebhookPublicJwkRequest.describe(
								"The public JWK for encrypting webhook payloads.",
							),
							algorithm: z
								.literal("RSA-OAEP-256")
								.describe("The JWE algorithm to use for webhook delivery."),
							key_type: z
								.literal("RSA")
								.describe("The JWK key type for webhook delivery."),
						})
						.openapi("CreateWebhookEncryptionKeyRequest"),
				},
			},
		},
	},
	tags: ["Webhooks"],
	summary: "Create a webhook encryption key",
	description:
		"Register a new encryption key (JWK) for a webhook endpoint. The key will be used for encrypting webhook payloads.",
	security: [{ bearerAuth: [] }],
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						data: WebhookEncryptionKey,
						error: z.null(),
					}),
				},
			},
			description: "Successful operation.",
		},
		400: {
			content: {
				"application/json": {
					schema: ErrorResponse.openapi({
						example: {
							data: null,
							error: {
								code: "BAD_REQUEST",
								message: "Bad request.",
								hint: "The request payload is invalid.",
								docs: "https://kayle.id/docs/api/webhooks/keys#create",
							},
						},
					}),
				},
			},
			description: "Bad request.",
		},
		404: {
			content: {
				"application/json": {
					schema: ErrorResponse.openapi({
						example: {
							data: null,
							error: {
								code: "NOT_FOUND",
								message: "Webhook endpoint not found.",
								hint: "The webhook endpoint with the given ID was not found.",
								docs: "https://kayle.id/docs/api/webhooks/keys#create",
							},
						},
					}),
				},
			},
			description: "Webhook endpoint not found.",
		},
		500: {
			content: {
				"application/json": {
					schema: InternalServerErrorResponse,
				},
			},
			description: "Internal server error.",
		},
	},
});
