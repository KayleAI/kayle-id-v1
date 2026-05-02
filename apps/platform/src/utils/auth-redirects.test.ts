import { expect, test } from "vitest";
import { rewriteAuthRedirectLocation } from "./auth-redirects";

const PUBLIC_HOST = "https://localhost:3000";

test("rewriteAuthRedirectLocation maps internal service auth redirects to public auth routes", () => {
	expect(
		rewriteAuthRedirectLocation(
			"http://api/v1/auth/magic/verify-link?token=token_123",
			PUBLIC_HOST,
		),
	).toBe("https://localhost:3000/api/auth/magic/verify-link?token=token_123");
});

test("rewriteAuthRedirectLocation maps relative internal auth redirects to public auth routes", () => {
	expect(
		rewriteAuthRedirectLocation(
			"/v1/auth/callback/google?code=oauth_code",
			PUBLIC_HOST,
		),
	).toBe("https://localhost:3000/api/auth/callback/google?code=oauth_code");
});

test("rewriteAuthRedirectLocation keeps external provider redirects unchanged", () => {
	expect(
		rewriteAuthRedirectLocation(
			"https://accounts.google.com/o/oauth2/v2/auth?client_id=google_client",
			PUBLIC_HOST,
		),
	).toBe(
		"https://accounts.google.com/o/oauth2/v2/auth?client_id=google_client",
	);
});
