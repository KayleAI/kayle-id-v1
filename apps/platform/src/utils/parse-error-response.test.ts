import { describe, expect, test } from "vitest";
import { parseErrorResponse } from "./parse-error-response";

describe("parseErrorResponse", () => {
	test("returns structured API error messages", async () => {
		const response = Response.json({
			error: {
				message: "API request failed.",
			},
		});

		await expect(
			parseErrorResponse(response, "Default failure."),
		).resolves.toBe("API request failed.");
	});

	test("returns plain text error bodies", async () => {
		const response = new Response("Plain text failure.", {
			status: 500,
		});

		await expect(
			parseErrorResponse(response, "Default failure."),
		).resolves.toBe("Plain text failure.");
	});

	test("uses the default message for empty or malformed error envelopes", async () => {
		await expect(
			parseErrorResponse(new Response("", { status: 500 }), "Default failure."),
		).resolves.toBe("Default failure.");

		await expect(
			parseErrorResponse(Response.json({ error: {} }), "Default failure."),
		).resolves.toBe("Default failure.");
	});
});
