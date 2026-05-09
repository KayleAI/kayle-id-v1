import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { events } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { eq } from "drizzle-orm";
import app from "@/index";
import { seedWebhookEventWithDelivery } from "./helpers/webhook-fixtures";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	if (!TEST_DATA?.organizationId) {
		return;
	}

	await db
		.delete(webhook_endpoints)
		.where(eq(webhook_endpoints.organizationId, TEST_DATA.organizationId));
	await db
		.delete(events)
		.where(eq(events.organizationId, TEST_DATA.organizationId));
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

async function seedDelivery(): Promise<string> {
	const seeded = await seedWebhookEventWithDelivery({
		context: "delivery",
		eventType: "verification.attempt.succeeded",
		organizationId: TEST_DATA?.organizationId ?? "",
		signingSecretPlaintext: "whsec_delivery_route_secret",
		url: "https://example.com/webhooks/deliveries",
	});

	return seeded.deliveryId;
}

describe("/v1/webhooks/deliveries", () => {
	test("rejects oversized delivery route IDs before lookup", async () => {
		const retryResponse = await app.request(
			`/v1/webhooks/deliveries/whd_${"a".repeat(200)}/retry`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(retryResponse.status).toBe(400);
	});

	test("does not retry a delivery that is already in progress", async () => {
		const deliveryId = await seedDelivery();
		await db
			.update(webhook_deliveries)
			.set({
				attemptCount: 1,
				lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
				lastStatusCode: null,
				status: "delivering",
			})
			.where(eq(webhook_deliveries.id, deliveryId));

		const retryResponse = await app.request(
			`/v1/webhooks/deliveries/${deliveryId}/retry`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(retryResponse.status).toBe(409);

		const [delivery] = await db
			.select()
			.from(webhook_deliveries)
			.where(eq(webhook_deliveries.id, deliveryId))
			.limit(1);

		expect(delivery?.status).toBe("delivering");
		expect(delivery?.attemptCount).toBe(1);
	});

	test("lists deliveries and retries a delivery", async () => {
		const deliveryId = await seedDelivery();

		const listResponse = await app.request("/v1/webhooks/deliveries?limit=10", {
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			},
			method: "GET",
		});

		expect(listResponse.status).toBe(200);

		const listPayload = (await listResponse.json()) as {
			data: Array<{
				attempt_count: number;
				id: string;
				status: "delivering" | "failed" | "pending" | "succeeded";
			}>;
			error: null;
			pagination: {
				has_more: boolean;
				limit: number;
				next_cursor: string | null;
			};
		};

		expect(listPayload.error).toBeNull();
		expect(
			listPayload.data.find((delivery) => delivery.id === deliveryId),
		).toMatchObject({
			attempt_count: 0,
			id: deliveryId,
			status: "pending",
		});

		await db
			.update(webhook_deliveries)
			.set({
				attemptCount: 2,
				lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
				lastStatusCode: 500,
				nextAttemptAt: null,
				status: "failed",
			})
			.where(eq(webhook_deliveries.id, deliveryId));

		const retryResponse = await app.request(
			`/v1/webhooks/deliveries/${deliveryId}/retry`,
			{
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "POST",
			},
		);

		expect(retryResponse.status).toBe(200);

		const retryPayload = (await retryResponse.json()) as {
			data: {
				attempt_count: number;
				id: string;
				last_attempt_at: string | null;
				last_status_code: number | null;
				next_attempt_at: string | null;
				status: "delivering" | "failed" | "pending" | "succeeded";
			};
			error: null;
		};

		expect(retryPayload.error).toBeNull();
		expect(retryPayload.data.id).toBe(deliveryId);
		expect(retryPayload.data.status).toBe("pending");
		expect(retryPayload.data.attempt_count).toBe(0);
		expect(retryPayload.data.last_attempt_at).toBeNull();
		expect(retryPayload.data.last_status_code).toBeNull();
		expect(retryPayload.data.next_attempt_at).toBeNull();
	});
});
