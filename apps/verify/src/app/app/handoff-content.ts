import { VERIFY_HANDOFF_COPY } from "@kayle-id/config/verify-handoff-copy";
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
): TerminalContent {
	if (sessionStatus.status === "cancelled") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.cancelled,
		};
	}

	if (sessionStatus.status === "expired") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.expired,
		};
	}

	const failureCode = sessionStatus.latest_attempt?.failure_code;

	if (failureCode === "document_authenticity_failed") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.documentAuthenticityFailed,
		};
	}

	if (failureCode === "document_active_authentication_failed") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal
				.documentActiveAuthenticationFailed,
		};
	}

	if (failureCode === "document_chip_authentication_failed") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.documentChipAuthenticationFailed,
		};
	}

	if (failureCode === "selfie_face_mismatch") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.selfieFaceMismatch,
		};
	}

	if (sessionStatus.latest_attempt?.status === "failed") {
		return {
			colour: "red",
			...VERIFY_HANDOFF_COPY.screens.terminal.failed,
		};
	}

	return {
		colour: "emerald",
		...VERIFY_HANDOFF_COPY.screens.terminal.success,
	};
}

export function buildInitialScreenContent({
	os,
}: {
	os: string | null;
}): ScreenContent {
	return {
		colour: "blue",
		headerDescription: VERIFY_HANDOFF_COPY.screens.initial.headerDescription,
		headerTitle: VERIFY_HANDOFF_COPY.screens.initial.headerTitle,
		messageDescription:
			os === "ios"
				? VERIFY_HANDOFF_COPY.screens.initial.iosMessageDescription
				: VERIFY_HANDOFF_COPY.screens.initial.defaultMessageDescription,
		messageTitle: VERIFY_HANDOFF_COPY.screens.initial.messageTitle,
	};
}

export function buildConnectedScreenContent(): ScreenContent {
	return {
		colour: "blue",
		...VERIFY_HANDOFF_COPY.screens.connected,
	};
}

export function buildRetryableFailureScreenContent(): ScreenContent {
	return {
		colour: "red",
		...VERIFY_HANDOFF_COPY.screens.retryableFailure,
	};
}

export function buildSameDeviceScreenContent(): ScreenContent {
	return {
		colour: "blue",
		...VERIFY_HANDOFF_COPY.screens.sameDeviceOnly,
	};
}

export function buildTerminalScreenContent({
	redirectCountdownFallbackSeconds,
	redirectCountdown,
	redirectTargetUrl,
	terminalContent,
}: {
	redirectCountdownFallbackSeconds: number;
	redirectCountdown: number | null;
	redirectTargetUrl: string | null;
	terminalContent: TerminalContent;
}): ScreenContent {
	return {
		colour: terminalContent.colour,
		headerDescription: redirectTargetUrl
			? VERIFY_HANDOFF_COPY.screens.terminal.redirectHeaderDescription
			: VERIFY_HANDOFF_COPY.screens.terminal.finishedHeaderDescription,
		headerTitle: terminalContent.title,
		messageDescription: redirectTargetUrl
			? `${terminalContent.description} Redirecting in ${
					redirectCountdown ?? redirectCountdownFallbackSeconds
				} seconds.`
			: `${terminalContent.description} ${
					VERIFY_HANDOFF_COPY.screens.terminal.youCanCloseDescription
				}`,
		messageTitle:
			terminalContent.colour === "emerald"
				? VERIFY_HANDOFF_COPY.screens.terminal.successMessageTitle
				: VERIFY_HANDOFF_COPY.screens.terminal.outcomeMessageTitle,
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
