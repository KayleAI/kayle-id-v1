import { auth } from "@kayle-id/auth/server";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_members,
	auth_organizations,
	auth_users,
} from "@kayle-id/database/schema/auth";
import { eq } from "drizzle-orm";

type SessionAuthSetupOptions = {
	withActiveOrganization?: boolean;
	emailVerified?: boolean;
};

type SessionAuthTestData = {
	organizationId: string | null;
	sessionCookie: string;
	userId: string;
};

const COOKIE_HEADER_SPLIT_PATTERN = /;\s*/u;
const SET_COOKIE_SPLIT_PATTERN = /, (?=[^;]+?=)/u;

function getSetCookieHeader(response: Response): string | null {
	const setCookies = response.headers.getSetCookie();

	if (setCookies.length > 0) {
		return setCookies.join(", ");
	}

	return response.headers.get("set-cookie");
}

function mergeCookieHeader(
	currentCookieHeader: string | null,
	setCookieHeader: string | null,
): string {
	const cookies = new Map<string, string>();

	if (currentCookieHeader) {
		for (const part of currentCookieHeader.split(COOKIE_HEADER_SPLIT_PATTERN)) {
			const [name, ...valueParts] = part.split("=");
			const value = valueParts.join("=");

			if (name && value) {
				cookies.set(name, value);
			}
		}
	}

	if (setCookieHeader) {
		for (const cookie of setCookieHeader.split(SET_COOKIE_SPLIT_PATTERN)) {
			const [cookiePair] = cookie.split(";");
			const separatorIndex = cookiePair.indexOf("=");

			if (separatorIndex === -1) {
				continue;
			}

			cookies.set(
				cookiePair.slice(0, separatorIndex),
				cookiePair.slice(separatorIndex + 1),
			);
		}
	}

	return Array.from(cookies.entries())
		.map(([name, value]) => `${name}=${value}`)
		.join("; ");
}

export async function setupSessionAuth({
	withActiveOrganization = false,
	emailVerified = false,
}: SessionAuthSetupOptions = {}): Promise<SessionAuthTestData> {
	const credentials = {
		email: `${crypto.randomUUID()}@test.kayle.id`,
		name: "Test User",
		password: "test123456",
	};
	const signUpResponse = await auth.api.signUpEmail({
		asResponse: true,
		body: credentials,
	});

	if (!signUpResponse.ok) {
		throw new Error(`auth_sign_up_failed:${signUpResponse.status}`);
	}

	const signUpPayload = (await signUpResponse.json()) as {
		user: { id: string };
	};
	let organizationId: string | null = null;
	let sessionCookie = mergeCookieHeader(
		null,
		getSetCookieHeader(signUpResponse),
	);

	// Sign-up auto-issues a session cached in secondary storage with the
	// freshly created user, who is `emailVerified: false`. Tests that need a
	// verified caller must update the DB *and* refresh that cached session,
	// otherwise routes that read `session.user.emailVerified` (e.g.
	// `change-email`) will see the stale value.
	if (emailVerified) {
		await db
			.update(auth_users)
			.set({ emailVerified: true })
			.where(eq(auth_users.id, signUpPayload.user.id));

		const signInResponse = await auth.api.signInEmail({
			asResponse: true,
			body: { email: credentials.email, password: credentials.password },
		});
		if (!signInResponse.ok) {
			throw new Error(`auth_sign_in_failed:${signInResponse.status}`);
		}
		sessionCookie = mergeCookieHeader(null, getSetCookieHeader(signInResponse));
	}

	if (withActiveOrganization) {
		organizationId = crypto.randomUUID();

		await db.insert(auth_organizations).values({
			createdAt: new Date(),
			id: organizationId,
			name: "Test Organization",
			slug: `test-${crypto.randomUUID()}`,
		});

		await db.insert(auth_organization_members).values({
			createdAt: new Date(),
			organizationId,
			role: "owner",
			userId: signUpPayload.user.id,
		});

		const setActiveOrganizationResponse = await auth.api.setActiveOrganization({
			asResponse: true,
			body: {
				organizationId,
			},
			headers: new Headers({
				cookie: sessionCookie,
			}),
		});

		if (!setActiveOrganizationResponse.ok) {
			throw new Error(
				`auth_set_active_organization_failed:${setActiveOrganizationResponse.status}`,
			);
		}

		sessionCookie = mergeCookieHeader(
			sessionCookie,
			getSetCookieHeader(setActiveOrganizationResponse),
		);
	}

	return {
		organizationId,
		sessionCookie,
		userId: signUpPayload.user.id,
	};
}

/**
 * Re-issue a session cookie with `organizationId` set as the active org.
 * Used by tests that sign up an extra "member" user, attach them to an
 * existing org, and need their session to point at that org.
 */
export async function setActiveOrganizationOnSession({
	organizationId,
	sessionCookie,
}: {
	organizationId: string;
	sessionCookie: string;
}): Promise<string> {
	const response = await auth.api.setActiveOrganization({
		asResponse: true,
		body: { organizationId },
		headers: new Headers({ cookie: sessionCookie }),
	});
	if (!response.ok) {
		throw new Error(`auth_set_active_organization_failed:${response.status}`);
	}
	return mergeCookieHeader(sessionCookie, getSetCookieHeader(response));
}

export async function teardownSessionAuth(
	testData?: SessionAuthTestData,
): Promise<void> {
	if (!testData) {
		return;
	}

	await db.delete(auth_users).where(eq(auth_users.id, testData.userId));

	if (testData.organizationId) {
		await db
			.delete(auth_organizations)
			.where(eq(auth_organizations.id, testData.organizationId));
	}
}

export type { SessionAuthTestData };
