import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import v1 from "@/v1";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("/v1/sessions share contract age gate validation", () => {
	test.serial(
		"Multiple age_over claims return MULTIPLE_AGE_GATES_NOT_ALLOWED",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						age_over_18: { required: true, reason: "Age gate 1" },
						age_over_21: { required: true, reason: "Age gate 2" },
					},
				}),
			});

			expect(response.status).toBe(400);
			const payload = (await response.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("MULTIPLE_AGE_GATES_NOT_ALLOWED");
		},
	);

	test.serial(
		"DOB + age_over is accepted; both required → both stored required",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						date_of_birth: { required: true, reason: "DOB" },
						age_over_18: { required: true, reason: "Age gate" },
					},
				}),
			});

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: {
					share_fields: Record<string, { required: boolean; reason: string }>;
				};
			};
			expect(payload.data.share_fields.date_of_birth.required).toBe(true);
			expect(payload.data.share_fields.age_over_18.required).toBe(true);
		},
	);

	test.serial(
		"DOB required + age_over optional silently promotes age_over to required",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						date_of_birth: { required: true, reason: "DOB" },
						age_over_18: { required: false, reason: "" },
					},
				}),
			});

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: { share_fields: Record<string, { required: boolean }> };
			};
			expect(payload.data.share_fields.date_of_birth.required).toBe(true);
			expect(payload.data.share_fields.age_over_18.required).toBe(true);
		},
	);

	test.serial(
		"DOB optional + age_over required silently promotes DOB to required",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						date_of_birth: { required: false, reason: "DOB" },
						age_over_18: { required: true, reason: "Age gate" },
					},
				}),
			});

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: { share_fields: Record<string, { required: boolean }> };
			};
			expect(payload.data.share_fields.date_of_birth.required).toBe(true);
			expect(payload.data.share_fields.age_over_18.required).toBe(true);
		},
	);

	test.serial(
		"DOB optional + age_over optional preserves both as optional",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						date_of_birth: { required: false, reason: "DOB" },
						age_over_18: { required: false, reason: "" },
					},
				}),
			});

			expect(response.status).toBe(200);
			const payload = (await response.json()) as {
				data: { share_fields: Record<string, { required: boolean }> };
			};
			expect(payload.data.share_fields.date_of_birth.required).toBe(false);
			expect(payload.data.share_fields.age_over_18.required).toBe(false);
		},
	);

	test.serial(
		"age_over without DOB still requires a non-empty reason",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						age_over_18: { required: true, reason: "" },
					},
				}),
			});

			expect(response.status).toBe(400);
			const payload = (await response.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("REASON_REQUIRED");
		},
	);

	test.serial("Age gates below 12 return INVALID_AGE_GATE_KEY", async () => {
		const response = await v1.request("/sessions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				share_fields: {
					age_over_11: { required: true, reason: "Invalid threshold" },
				},
			}),
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as { error: { code: string } };
		expect(payload.error.code).toBe("INVALID_AGE_GATE_KEY");
	});

	test.serial(
		"Invalid age_over format returns INVALID_AGE_GATE_KEY",
		async () => {
			const response = await v1.request("/sessions", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${TEST_DATA?.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					share_fields: {
						age_over_abc: {
							required: true,
							reason: "Invalid threshold format",
						},
					},
				}),
			});

			expect(response.status).toBe(400);
			const payload = (await response.json()) as { error: { code: string } };
			expect(payload.error.code).toBe("INVALID_AGE_GATE_KEY");
		},
	);
});
