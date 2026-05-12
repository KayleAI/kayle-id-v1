import type { VerifyHandoffCopy } from "@kayle-id/translations/verify-handoff-copy";
import type {
	HandoffPayload,
	VerifySessionStatusPayload,
} from "@/config/handoff";

export type CardTone = "blue" | "emerald" | "red";

export type ScreenContent = {
	colour: CardTone;
	headerDescription: string;
	headerTitle: string;
	messageDescription: string;
	messageTitle: string;
};

type TerminalContent = {
	colour: CardTone;
	description: string;
	title: string;
};

export function buildHandoffUrl(
	payload: HandoffPayload,
	cancelToken?: string,
): string {
	// Embed cancel_token (when available) into the QR payload so the iOS app
	// can call POST /v1/verify/session/:id/cancel with the same auth that the
	// verify browser uses. Older builds that don't read this field continue to
	// ignore it harmlessly.
	const data = cancelToken
		? { ...payload, cancel_token: cancelToken }
		: payload;
	return `kayle-id://${encodeURIComponent(JSON.stringify(data))}`;
}

export function isHandoffPayloadExpired(
	payload: HandoffPayload,
	nowMs: number,
): boolean {
	return new Date(payload.expires_at).getTime() <= nowMs;
}

export function buildTerminalContent(
	sessionStatus: VerifySessionStatusPayload,
	copy: VerifyHandoffCopy,
): TerminalContent {
	if (sessionStatus.status === "cancelled") {
		return {
			colour: "red",
			...copy.screens.terminal.cancelled,
		};
	}

	if (sessionStatus.status === "expired") {
		return {
			colour: "red",
			...copy.screens.terminal.expired,
		};
	}

	const failureCode = sessionStatus.latest_attempt?.failure_code;

	if (failureCode === "document_authenticity_failed") {
		return {
			colour: "red",
			...copy.screens.terminal.documentAuthenticityFailed,
		};
	}

	if (failureCode === "document_active_authentication_failed") {
		return {
			colour: "red",
			...copy.screens.terminal.documentActiveAuthenticationFailed,
		};
	}

	if (failureCode === "document_chip_authentication_failed") {
		return {
			colour: "red",
			...copy.screens.terminal.documentChipAuthenticationFailed,
		};
	}

	if (failureCode === "selfie_face_mismatch") {
		return {
			colour: "red",
			...copy.screens.terminal.selfieFaceMismatch,
		};
	}

	if (sessionStatus.latest_attempt?.status === "failed") {
		return {
			colour: "red",
			...copy.screens.terminal.failed,
		};
	}

	return {
		colour: "emerald",
		...copy.screens.terminal.success,
	};
}

export function buildInitialScreenContent({
	os,
	copy,
}: {
	os: string | null;
	copy: VerifyHandoffCopy;
}): ScreenContent {
	return {
		colour: "blue",
		headerDescription: copy.screens.initial.headerDescription,
		headerTitle: copy.screens.initial.headerTitle,
		messageDescription:
			os === "ios"
				? copy.screens.initial.iosMessageDescription
				: copy.screens.initial.defaultMessageDescription,
		messageTitle: copy.screens.initial.messageTitle,
	};
}

export function buildConnectedScreenContent(
	copy: VerifyHandoffCopy,
): ScreenContent {
	return {
		colour: "blue",
		...copy.screens.connected,
	};
}

export function buildRetryableFailureScreenContent(
	copy: VerifyHandoffCopy,
): ScreenContent {
	return {
		colour: "red",
		...copy.screens.retryableFailure,
	};
}

export function buildSameDeviceScreenContent(
	copy: VerifyHandoffCopy,
): ScreenContent {
	return {
		colour: "blue",
		...copy.screens.sameDeviceOnly,
	};
}

export function buildTerminalScreenContent({
	copy,
	redirectCountdownFallbackSeconds,
	redirectCountdown,
	redirectTargetUrl,
	terminalContent,
}: {
	copy: VerifyHandoffCopy;
	redirectCountdownFallbackSeconds: number;
	redirectCountdown: number | null;
	redirectTargetUrl: string | null;
	terminalContent: TerminalContent;
}): ScreenContent {
	return {
		colour: terminalContent.colour,
		headerDescription: redirectTargetUrl
			? copy.screens.terminal.redirectHeaderDescription
			: copy.screens.terminal.finishedHeaderDescription,
		headerTitle: terminalContent.title,
		messageDescription: redirectTargetUrl
			? `${terminalContent.description} Redirecting in ${
					redirectCountdown ?? redirectCountdownFallbackSeconds
				} seconds.`
			: `${terminalContent.description} ${
					copy.screens.terminal.youCanCloseDescription
				}`,
		messageTitle:
			terminalContent.colour === "emerald"
				? copy.screens.terminal.successMessageTitle
				: copy.screens.terminal.outcomeMessageTitle,
	};
}

export function requiresSameDeviceOnly(
	sessionStatus: VerifySessionStatusPayload | null,
): boolean {
	return Boolean(
		sessionStatus &&
			!sessionStatus.is_terminal &&
			sessionStatus.status !== "in_progress" &&
			sessionStatus.same_device_only,
	);
}

export function isRetryableFailureState(
	sessionStatus: VerifySessionStatusPayload | null,
): boolean {
	return Boolean(
		sessionStatus &&
			!sessionStatus.is_terminal &&
			sessionStatus.latest_attempt?.status === "failed" &&
			sessionStatus.latest_attempt.retry_allowed,
	);
}

export function shouldShowHandoff(
	sessionStatus: VerifySessionStatusPayload | null,
): boolean {
	return Boolean(
		sessionStatus &&
			!sessionStatus.is_terminal &&
			sessionStatus.status !== "in_progress" &&
			!sessionStatus.same_device_only,
	);
}

export function shouldCloseBrowserOnly(
	sessionStatus: VerifySessionStatusPayload | null,
): boolean {
	return Boolean(
		sessionStatus &&
			!sessionStatus.is_terminal &&
			(sessionStatus.status === "in_progress" ||
				sessionStatus.same_device_only ||
				(sessionStatus.latest_attempt?.status === "failed" &&
					sessionStatus.latest_attempt.retry_allowed)),
	);
}
