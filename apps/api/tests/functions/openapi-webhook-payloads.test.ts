import { expect, test } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { registerWebhookPayloadOpenApi } from "@/openapi/models/webhook";

type OpenApiSchemaObject = {
	enum?: string[];
	properties?: Record<string, OpenApiSchemaObject>;
};

test("OpenAPI documents actual webhook delivery payloads", async () => {
	const app = new OpenAPIHono();
	registerWebhookPayloadOpenApi(app.openAPIRegistry);
	app.doc31("/openapi", {
		info: {
			title: "Kayle ID",
			version: "0.0.0-test",
		},
		openapi: "3.1.0",
	});

	const response = await app.request("/openapi");
	expect(response.status).toBe(200);

	const document = (await response.json()) as {
		components?: {
			schemas?: Record<string, OpenApiSchemaObject>;
		};
		webhooks?: Record<
			string,
			{
				post?: {
					requestBody?: {
						content?: {
							"application/json"?: {
								schema?: { $ref?: string };
							};
						};
					};
				};
			}
		>;
	};

	expect(document.webhooks).toBeDefined();
	expect(document.webhooks?.["verification.attempt.succeeded"]).toBeDefined();
	expect(document.webhooks?.["verification.attempt.failed"]).toBeDefined();
	expect(document.webhooks?.["verification.session.expired"]).toBeDefined();
	expect(document.webhooks?.["verification.session.cancelled"]).toBeDefined();

	const failedPayloadRef =
		document.webhooks?.["verification.attempt.failed"]?.post?.requestBody
			?.content?.["application/json"]?.schema?.$ref;

	expect(failedPayloadRef).toBe(
		"#/components/schemas/VerificationAttemptFailedWebhookPayload",
	);

	const failedPayloadSchema =
		document.components?.schemas?.VerificationAttemptFailedWebhookPayload;
	const failedPayloadDataProperties =
		failedPayloadSchema?.properties?.data?.properties;

	expect(Object.keys(failedPayloadDataProperties ?? {})).toEqual([
		"failure_code",
	]);
	expect(Array.isArray(failedPayloadDataProperties?.failure_code?.enum)).toBe(
		true,
	);
});
