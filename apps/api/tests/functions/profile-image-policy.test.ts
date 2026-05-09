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

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

let testSession: SessionAuthTestData | undefined;

function jsonHeaders(cookie: string): HeadersInit {
	return {
		"Content-Type": "application/json",
		Cookie: cookie,
	};
}

async function getUserImage(userId: string): Promise<null | string> {
	const [row] = await db
		.select({ image: auth_users.image })
		.from(auth_users)
		.where(eq(auth_users.id, userId));

	return row?.image ?? null;
}

afterEach(async () => {
	await teardownSessionAuth(testSession);
	testSession = undefined;
});

test("rejects direct profile image updates with external URLs", async () => {
	testSession = await setupSessionAuth();

	const response = await app.request("/v1/auth/update-user", {
		body: JSON.stringify({
			image: "https://example.com/avatar.png",
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getUserImage(testSession.userId)).toBeNull();
});

test("rejects direct profile image updates with unsupported data URLs", async () => {
	testSession = await setupSessionAuth();

	const response = await app.request("/v1/auth/update-user", {
		body: JSON.stringify({
			image: "data:image/svg+xml;base64,PHN2Zy8+",
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(response.status).toBe(400);
	expect(await getUserImage(testSession.userId)).toBeNull();
});

test("allows direct profile image updates with bounded local image data URLs", async () => {
	testSession = await setupSessionAuth();

	const setResponse = await app.request("/v1/auth/update-user", {
		body: JSON.stringify({
			image: PNG_DATA_URL,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(setResponse.status).toBe(200);
	expect(await getUserImage(testSession.userId)).toBe(PNG_DATA_URL);

	const clearResponse = await app.request("/v1/auth/update-user", {
		body: JSON.stringify({
			image: null,
		}),
		headers: jsonHeaders(testSession.sessionCookie),
		method: "POST",
	});

	expect(clearResponse.status).toBe(200);
	expect(await getUserImage(testSession.userId)).toBeNull();
});
