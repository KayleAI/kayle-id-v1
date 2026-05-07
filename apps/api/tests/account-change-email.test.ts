import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { auth } from "@kayle-id/auth/server";
import { db } from "@kayle-id/database/drizzle";
import { auth_users } from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";
import app from "@/index";
import {
	type SessionAuthTestData,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

type ChangeEmailResponse = { status?: boolean };

let UNVERIFIED_CALLER: SessionAuthTestData | undefined;
let VERIFIED_CALLER: SessionAuthTestData | undefined;

const originalSendVerificationEmail =
	auth.options.emailVerification?.sendVerificationEmail;

function requireUnverifiedCaller(): SessionAuthTestData {
	if (!UNVERIFIED_CALLER) {
		throw new Error("change_email_unverified_caller_missing");
	}
	return UNVERIFIED_CALLER;
}

function requireVerifiedCaller(): SessionAuthTestData {
	if (!VERIFIED_CALLER) {
		throw new Error("change_email_verified_caller_missing");
	}
	return VERIFIED_CALLER;
}

function requireEmailVerificationConfig(): NonNullable<
	typeof auth.options.emailVerification
> {
	const config = auth.options.emailVerification;
	if (!config) {
		throw new Error("email_verification_config_missing");
	}
	return config;
}

interface CapturedVerificationCall {
	deliveredTo: string;
	url: string;
}

function captureNextVerificationCall(): Promise<CapturedVerificationCall> {
	return new Promise((resolve) => {
		requireEmailVerificationConfig().sendVerificationEmail = async ({
			user: deliveredUser,
			url,
		}) => {
			resolve({ deliveredTo: deliveredUser.email, url });
		};
	});
}

beforeAll(async () => {
	UNVERIFIED_CALLER = await setupSessionAuth();
	VERIFIED_CALLER = await setupSessionAuth({ emailVerified: true });
});

afterEach(() => {
	if (originalSendVerificationEmail) {
		requireEmailVerificationConfig().sendVerificationEmail =
			originalSendVerificationEmail;
	}
});

afterAll(async () => {
	await teardownSessionAuth(UNVERIFIED_CALLER);
	UNVERIFIED_CALLER = undefined;
	await teardownSessionAuth(VERIFIED_CALLER);
	VERIFIED_CALLER = undefined;
});

describe("Account — change-email", () => {
	test("verified caller: sends confirmation link to new address; email updates only after the link is clicked", async () => {
		const caller = requireVerifiedCaller();
		const newEmail = `${crypto.randomUUID()}@test.kayle.id`;

		const captured = captureNextVerificationCall();

		const triggerResponse = await app.request("/v1/auth/change-email", {
			body: JSON.stringify({ newEmail, callbackURL: "/account" }),
			headers: {
				"Content-Type": "application/json",
				Cookie: caller.sessionCookie,
			},
			method: "POST",
		});
		expect(triggerResponse.status).toBe(200);
		const triggerPayload =
			(await triggerResponse.json()) as ChangeEmailResponse;
		expect(triggerPayload.status).toBe(true);

		const { deliveredTo, url } = await captured;
		expect(deliveredTo).toBe(newEmail);

		// Email should NOT change until the user clicks the link.
		const [beforeClick] = await db
			.select({ email: auth_users.email })
			.from(auth_users)
			.where(eq(auth_users.id, caller.userId));
		expect(beforeClick?.email).not.toBe(newEmail);

		const verifyUrl = new URL(url);
		const token = verifyUrl.searchParams.get("token");
		expect(token).toBeString();

		const callbackResponse = await app.request(
			`/v1/auth/verify-email?token=${token}`,
			{
				headers: { Cookie: caller.sessionCookie },
				method: "GET",
				redirect: "manual",
			},
		);
		if (callbackResponse.status !== 200) {
			throw new Error(
				`verify-email returned ${callbackResponse.status}: ${await callbackResponse.text()}`,
			);
		}

		const [user] = await db
			.select({
				email: auth_users.email,
				emailVerified: auth_users.emailVerified,
			})
			.from(auth_users)
			.where(eq(auth_users.id, caller.userId));
		expect(user?.email).toBe(newEmail);
		expect(user?.emailVerified).toBe(true);
	});

	test("unverified caller: updates email immediately (no confirmation link required)", async () => {
		const caller = requireUnverifiedCaller();
		const newEmail = `${crypto.randomUUID()}@test.kayle.id`;

		const triggerResponse = await app.request("/v1/auth/change-email", {
			body: JSON.stringify({ newEmail, callbackURL: "/account" }),
			headers: {
				"Content-Type": "application/json",
				Cookie: caller.sessionCookie,
			},
			method: "POST",
		});
		expect(triggerResponse.status).toBe(200);

		const [user] = await db
			.select({ email: auth_users.email })
			.from(auth_users)
			.where(eq(auth_users.id, caller.userId));
		expect(user?.email).toBe(newEmail);
	});
});
