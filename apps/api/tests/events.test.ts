import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { events as coreEvents } from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { eq } from "drizzle-orm";
import app from "@/index";
import { seedWebhookEventWithDelivery } from "./helpers/webhook-fixtures";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

type WebhookEventResponse = {
	created_at: string;
	deliveries: Array<{
		attempt_count: number;
		id: string;
		last_attempt_at: string | null;
		last_status_code: number | null;
		status: "delivering" | "failed" | "pending" | "succeeded";
		webhook_endpoint_id: string;
	}>;
	id: string;
	trigger_id: string;
	trigger_type: "verification_attempt" | "verification_session";
	type: string;
};

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
		.delete(coreEvents)
		.where(eq(coreEvents.organizationId, TEST_DATA.organizationId));
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

function seedWebhookEvent(): Promise<{
	deliveryId: string;
	endpointId: string;
	eventId: string;
}> {
	return seedWebhookEventWithType("verification.attempt.succeeded");
}

function seedWebhookEventWithType(
	eventType: "verification.attempt.failed" | "verification.attempt.succeeded",
): Promise<{
	deliveryId: string;
	endpointId: string;
	eventId: string;
}> {
	return seedWebhookEventWithDelivery({
		context: "events",
		eventType,
		organizationId: TEST_DATA?.organizationId ?? "",
	});
}

describe("/v1/webhooks/events", () => {
	test.serial(
		"rejects invalid event filters and route IDs before lookup",
		async () => {
			const listResponse = await app.request(
				"/v1/webhooks/events?type=unsupported.event",
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "GET",
				},
			);
			const getResponse = await app.request(
				`/v1/webhooks/events/evt_${"a".repeat(200)}`,
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "GET",
				},
			);

			expect(listResponse.status).toBe(400);
			expect(getResponse.status).toBe(400);
		},
	);

	test.serial(
		"GET / returns webhook events with delivery summaries",
		async () => {
			const seeded = await seedWebhookEvent();

			const response = await app.request("/v1/webhooks/events?limit=10", {
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				},
				method: "GET",
			});

			expect(response.status).toBe(200);

			const payload = (await response.json()) as {
				data: WebhookEventResponse[];
				error: null;
				pagination: {
					has_more: boolean;
					limit: number;
					next_cursor: string | null;
				};
			};

			const event = payload.data.find((item) => item.id === seeded.eventId);

			expect(payload.error).toBeNull();
			expect(event).toBeDefined();
			expect(event?.deliveries).toEqual([
				{
					attempt_count: 0,
					id: seeded.deliveryId,
					last_attempt_at: null,
					last_status_code: null,
					status: "pending",
					webhook_endpoint_id: seeded.endpointId,
				},
			]);
		},
	);

	test.serial(
		"GET /:event_id returns a single webhook event with delivery summaries",
		async () => {
			const seeded = await seedWebhookEvent();

			const response = await app.request(
				`/v1/webhooks/events/${seeded.eventId}`,
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "GET",
				},
			);

			expect(response.status).toBe(200);

			const payload = (await response.json()) as {
				data: WebhookEventResponse;
				error: null;
			};

			expect(payload.error).toBeNull();
			expect(payload.data.id).toBe(seeded.eventId);
			expect(payload.data.deliveries).toEqual([
				{
					attempt_count: 0,
					id: seeded.deliveryId,
					last_attempt_at: null,
					last_status_code: null,
					status: "pending",
					webhook_endpoint_id: seeded.endpointId,
				},
			]);
		},
	);

	test.serial(
		"POST /:event_id/replay requeues existing deliveries for the event",
		async () => {
			const seeded = await seedWebhookEvent();

			await db
				.update(webhook_deliveries)
				.set({
					attemptCount: 2,
					lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
					lastStatusCode: 500,
					nextAttemptAt: null,
					status: "failed",
				})
				.where(eq(webhook_deliveries.id, seeded.deliveryId));

			const response = await app.request(
				`/v1/webhooks/events/${seeded.eventId}/replay`,
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "POST",
				},
			);

			expect(response.status).toBe(202);

			const payload = (await response.json()) as {
				data: WebhookEventResponse;
				error: null;
			};

			expect(payload.error).toBeNull();
			expect(payload.data.id).toBe(seeded.eventId);
			expect(payload.data.deliveries).toEqual([
				{
					attempt_count: 0,
					id: seeded.deliveryId,
					last_attempt_at: null,
					last_status_code: null,
					status: "pending",
					webhook_endpoint_id: seeded.endpointId,
				},
			]);

			const [delivery] = await db
				.select()
				.from(webhook_deliveries)
				.where(eq(webhook_deliveries.id, seeded.deliveryId))
				.limit(1);

			expect(delivery?.status).toBe("pending");
			expect(delivery?.attemptCount).toBe(0);
			expect(delivery?.lastAttemptAt).toBeNull();
			expect(delivery?.lastStatusCode).toBeNull();
		},
	);

	test.serial(
		"POST /:event_id/replay requeues failed attempt event deliveries",
		async () => {
			const seeded = await seedWebhookEventWithType(
				"verification.attempt.failed",
			);

			await db
				.update(webhook_deliveries)
				.set({
					attemptCount: 1,
					lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
					lastStatusCode: 410,
					nextAttemptAt: null,
					status: "failed",
				})
				.where(eq(webhook_deliveries.id, seeded.deliveryId));

			const response = await app.request(
				`/v1/webhooks/events/${seeded.eventId}/replay`,
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "POST",
				},
			);

			expect(response.status).toBe(202);

			const [delivery] = await db
				.select()
				.from(webhook_deliveries)
				.where(eq(webhook_deliveries.id, seeded.deliveryId))
				.limit(1);

			expect(delivery?.status).toBe("pending");
			expect(delivery?.attemptCount).toBe(0);
			expect(delivery?.lastAttemptAt).toBeNull();
			expect(delivery?.lastStatusCode).toBeNull();
		},
	);

	test.serial(
		"POST /:event_id/replay does not requeue deliveries already in progress",
		async () => {
			const seeded = await seedWebhookEvent();

			await db
				.update(webhook_deliveries)
				.set({
					attemptCount: 1,
					lastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
					lastStatusCode: null,
					nextAttemptAt: null,
					status: "delivering",
				})
				.where(eq(webhook_deliveries.id, seeded.deliveryId));

			const response = await app.request(
				`/v1/webhooks/events/${seeded.eventId}/replay`,
				{
					headers: {
						Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					},
					method: "POST",
				},
			);

			expect(response.status).toBe(409);

			const [delivery] = await db
				.select()
				.from(webhook_deliveries)
				.where(eq(webhook_deliveries.id, seeded.deliveryId))
				.limit(1);

			expect(delivery?.status).toBe("delivering");
			expect(delivery?.attemptCount).toBe(1);
		},
	);
});
