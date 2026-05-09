import { afterEach, expect, test } from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import { auth_users } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "../session-auth";

let testSession: SessionAuthTestData | undefined;

function jsonHeaders(cookie: string): HeadersInit {
	return {
		"Content-Type": "application/json",
		Cookie: cookie,
	};
}

async function getUserEmail(userId: string): Promise<string | undefined> {
	const [row] = await db
		.select({ email: auth_users.email })
		.from(auth_users)
		.where(eq(auth_users.id, userId));

	return row?.email;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct change-email requests with external callback URLs before mutating the account", async () => {
	testSession = await setupSessionAuth();
	const originalEmail = await getUserEmail(testSession.userId);

	const response = await app.request("/v1/auth/change-email", {
		body: JSON.stringify({
			callbackURL: "https://evil.example/account",
			newEmail: `${crypto.randomUUID()}@test.kayle.id`,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getUserEmail(testSession.userId)).toBe(originalEmail);
});

test("rejects direct send-verification-email requests with external callback URLs", async () => {
	testSession = await setupSessionAuth();
	const email = await getUserEmail(testSession.userId);
	if (!email) {
		throw new Error("auth_callback_policy_session_missing_email");
	}

	const response = await app.request("/v1/auth/send-verification-email", {
		body: JSON.stringify({
			callbackURL: "//evil.example/account",
			email,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
});
