import { parseSafeUrl } from "@kayle-id/config/safe-url";

const ALLOW_LOOPBACK_REDIRECTS = import.meta.env.DEV === true;

/**
 * Navigate the browser to an externally-supplied URL. The API is the primary
 * trust boundary for redirect URLs (validated by `safeRedirectUrl` on session
 * create), but we re-check here so a malformed or `javascript:` / `data:` URL
 * surviving a future regression cannot still execute via
 * `window.location.assign`. On rejection we silently no-op — the verify UI
 * already surfaces a "close this page" affordance for the terminal screen,
 * and there is no useful surface for diagnostics in the user's browser.
 */
export function redirectToUrl(targetUrl: string): void {
	const outcome = parseSafeUrl(targetUrl, {
		allowLoopback: ALLOW_LOOPBACK_REDIRECTS,
		mode: "redirect",
	});

	if (!outcome.ok) {
		return;
	}

	window.location.assign(outcome.url.toString());
}
