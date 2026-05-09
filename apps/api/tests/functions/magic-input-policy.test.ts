import { expect, test } from "bun:test";
import app from "@/index";

const JSON_HEADERS = {
	"Content-Type": "application/json",
} as const;

test("rejects magic-link verify tokens outside the generated token shape", async () => {
	const response = await app.request(
		`/v1/auth/magic/verify-link?token=${"a".repeat(33)}`,
		{
			headers: JSON_HEADERS,
			method: "GET",
		},
	);

	expect(response.status).toBe(400);
});

test("rejects magic OTP values outside the generated OTP shape", async () => {
	const response = await app.request("/v1/auth/magic/verify-otp", {
		body: JSON.stringify({
			email: "magic-policy@kayle.id",
			otp: "1234567",
			type: "sign-in",
		}),
		headers: JSON_HEADERS,
		method: "POST",
	});

	expect(response.status).toBe(400);
});

test("rejects oversized magic callback URLs", async () => {
	const response = await app.request("/v1/auth/magic/sign-in", {
		body: JSON.stringify({
			callbackURL: `/${"a".repeat(2048)}`,
			email: "magic-callback-policy@kayle.id",
			type: "sign-in",
		}),
		headers: JSON_HEADERS,
		method: "POST",
	});

	expect(response.status).toBe(400);
});
