const INTERNAL_AUTH_PATH = "/v1/auth";
const PUBLIC_AUTH_PATH = "/api/auth";

function rewriteInternalAuthPath(pathname: string): string | null {
	if (pathname === INTERNAL_AUTH_PATH) {
		return PUBLIC_AUTH_PATH;
	}

	if (!pathname.startsWith(`${INTERNAL_AUTH_PATH}/`)) {
		return null;
	}

	return pathname.replace(`${INTERNAL_AUTH_PATH}/`, `${PUBLIC_AUTH_PATH}/`);
}

export function rewriteAuthRedirectLocation(
	location: string,
	host: string,
): string {
	const publicHostUrl = new URL(host);
	const redirectUrl = new URL(location, host);
	const publicPathname = rewriteInternalAuthPath(redirectUrl.pathname);

	if (publicPathname) {
		redirectUrl.protocol = publicHostUrl.protocol;
		redirectUrl.host = publicHostUrl.host;
		redirectUrl.pathname = publicPathname;
	}

	return redirectUrl.toString();
}
