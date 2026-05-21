type Mode = "register" | "authenticate";

const REGISTER_MESSAGES: Record<string, string> = {
	NotAllowedError:
		"Passkey prompt was dismissed or timed out. Please try again.",
	InvalidStateError:
		"This device already has a passkey for your account. Use it to sign in instead.",
	AbortError: "Passkey setup was canceled.",
	SecurityError:
		"Your browser blocked the passkey request for security reasons.",
	NotSupportedError: "This device doesn't support the requested passkey type.",
	ConstraintError:
		"This device can't satisfy the passkey requirements (e.g. resident key support).",
};

const AUTHENTICATE_MESSAGES: Record<string, string> = {
	NotAllowedError:
		"Passkey prompt was dismissed or timed out. Please try again.",
	InvalidStateError: "No matching passkey was found on this device.",
	AbortError: "Passkey sign-in was canceled.",
	SecurityError:
		"Your browser blocked the passkey request for security reasons.",
	NotSupportedError: "This browser doesn't support passkey sign-in.",
};

export function friendlyPasskeyError(
	err: unknown,
	mode: Mode,
	fallback: string,
): string {
	const map = mode === "register" ? REGISTER_MESSAGES : AUTHENTICATE_MESSAGES;

	if (err instanceof DOMException && map[err.name]) {
		return map[err.name];
	}

	if (err instanceof Error) {
		// better-auth surfaces some browser DOMExceptions wrapped as Errors with
		// the original DOMException name preserved on the message.
		for (const name of Object.keys(map)) {
			if (err.name === name || err.message.includes(name)) {
				return map[name] ?? fallback;
			}
		}
		// The raw WebAuthn NotAllowedError message contains this URL fragment.
		if (err.message.includes("webauthn-2")) {
			return map.NotAllowedError ?? fallback;
		}
		return err.message || fallback;
	}

	if (typeof err === "object" && err !== null) {
		const passkeyError = err as {
			code?: unknown;
			message?: unknown;
			name?: unknown;
		};
		const code = typeof passkeyError.code === "string" ? passkeyError.code : "";
		const name = typeof passkeyError.name === "string" ? passkeyError.name : "";
		const message =
			typeof passkeyError.message === "string" ? passkeyError.message : "";

		if (code === "AUTH_CANCELLED" || code === "ERROR_CEREMONY_ABORTED") {
			return map.AbortError ?? fallback;
		}

		for (const key of Object.keys(map)) {
			if (code === key || name === key || message.includes(key)) {
				return map[key] ?? fallback;
			}
		}

		return message || fallback;
	}

	return fallback;
}
