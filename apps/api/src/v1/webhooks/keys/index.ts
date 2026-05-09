import { OpenAPIHono } from "@hono/zod-openapi";
import { db } from "@kayle-id/database/drizzle";
import {
	webhook_encryption_keys,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { deactivateWebhookEncryptionKey } from "@/openapi/v1/webhooks/keys/deactivate";
import { reactivateWebhookEncryptionKey } from "@/openapi/v1/webhooks/keys/reactivate";
import {
	acquireWebhookEndpointKeyMutationLock,
	mapKeyRowToResponse,
} from "@/v1/webhooks/endpoints/utils";

const webhookEncryptionKeys = new OpenAPIHono<{
	Bindings: CloudflareBindings;
	Variables: {
		organizationId: string;
		type: "api" | "session";
	};
}>();

async function findWebhookKeyByIdForOrganization({
	keyId,
	organizationId,
}: {
	keyId: string;
	organizationId: string;
}) {
	const [row] = await db
		.select({
			key: webhook_encryption_keys,
		})
		.from(webhook_encryption_keys)
		.innerJoin(
			webhook_endpoints,
			eq(webhook_endpoints.id, webhook_encryption_keys.webhookEndpointId),
		)
		.where(
			and(
				eq(webhook_encryption_keys.id, keyId),
				eq(webhook_endpoints.organizationId, organizationId),
			),
		)
		.limit(1);

	return row ?? null;
}

async function deactivateWebhookKey({ keyId }: { keyId: string }) {
	const [updated] = await db
		.update(webhook_encryption_keys)
		.set({
			disabledAt: new Date(),
			isActive: false,
		})
		.where(eq(webhook_encryption_keys.id, keyId))
		.returning();

	return updated;
}

async function reactivateWebhookKey({
	keyId,
	webhookEndpointId,
}: {
	keyId: string;
	webhookEndpointId: string;
}) {
	const now = new Date();

	return db.transaction(async (tx) => {
		await acquireWebhookEndpointKeyMutationLock(tx, webhookEndpointId);

		await tx
			.update(webhook_encryption_keys)
			.set({
				disabledAt: now,
				isActive: false,
			})
			.where(
				and(
					eq(webhook_encryption_keys.webhookEndpointId, webhookEndpointId),
					eq(webhook_encryption_keys.isActive, true),
				),
			);

		const [updated] = await tx
			.update(webhook_encryption_keys)
			.set({
				disabledAt: null,
				isActive: true,
			})
			.where(eq(webhook_encryption_keys.id, keyId))
			.returning();

		return updated;
	});
}

webhookEncryptionKeys.openapi(deactivateWebhookEncryptionKey, async (c) => {
	const organizationId = c.get("organizationId");
	const params = c.req.valid("param");
	const row = await findWebhookKeyByIdForOrganization({
		keyId: params.key_id,
		organizationId,
	});

	if (!row) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook encryption key not found.",
					hint: "The webhook encryption key with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/keys#deactivate",
				},
			},
			404,
		);
	}

	const updated = await deactivateWebhookKey({ keyId: row.key.id });
	if (!updated) {
		throw new Error("webhook_encryption_key_deactivate_failed");
	}
	const data = mapKeyRowToResponse(updated);

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
});

webhookEncryptionKeys.openapi(reactivateWebhookEncryptionKey, async (c) => {
	const organizationId = c.get("organizationId");
	const params = c.req.valid("param");
	const row = await findWebhookKeyByIdForOrganization({
		keyId: params.key_id,
		organizationId,
	});

	if (!row) {
		return c.json(
			{
				data: null,
				error: {
					code: "NOT_FOUND",
					message: "Webhook encryption key not found.",
					hint: "The webhook encryption key with the given ID was not found.",
					docs: "https://kayle.id/docs/api/webhooks/keys#reactivate",
				},
			},
			404,
		);
	}

	const updated = await reactivateWebhookKey({
		keyId: row.key.id,
		webhookEndpointId: row.key.webhookEndpointId,
	});
	if (!updated) {
		throw new Error("webhook_encryption_key_reactivate_failed");
	}
	const data = mapKeyRowToResponse(updated);

	return c.json(
		{
			data,
			error: null,
		},
		200,
	);
});

export default webhookEncryptionKeys;
