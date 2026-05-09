import { getForwardedClientIp } from "@kayle-id/config/client-ip";
import { generateRandomString } from "@kayle-id/config/random";
import { env } from "@/config/env";
import { DemoApiError } from "@/demo/api";
import type { DemoRunRecord, DemoRunView } from "@/demo/types";

const DEMO_RUN_ID_PATTERN = /^demo_[a-f0-9]{32}$/u;
const DEMO_RATE_LIMIT_KEY_PATTERN = /^demo_rate_[a-f0-9]{64}$/u;
const TEXT_ENCODER = new TextEncoder();

export function createJsonResponse(
	body: unknown,
	init?: ResponseInit,
): Response {
	return Response.json(body, init);
}

export function createRandomToken(length: number): string {
	return generateRandomString(length);
}

export function createDemoRunId(): string {
	return `demo_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function isDemoRunId(value: string): boolean {
	return DEMO_RUN_ID_PATTERN.test(value);
}

function hexBytes(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function createDemoRateLimitKey({
	request,
	salt,
}: {
	request: Request;
	salt: string;
}): Promise<string> {
	const clientIp = getForwardedClientIp(request.headers) ?? "anonymous";
	const digest = await crypto.subtle.digest(
		"SHA-256",
		TEXT_ENCODER.encode(`${salt}:${clientIp}`),
	);

	return `demo_rate_${hexBytes(new Uint8Array(digest))}`;
}

export function isDemoRateLimitKey(value: string): boolean {
	return DEMO_RATE_LIMIT_KEY_PATTERN.test(value);
}

export function getDemoRunStub(runId: string) {
	if (!env.DEMO_RUNS) {
		throw new DemoApiError({
			message: "DEMO_RUNS binding is not configured.",
			status: 500,
		});
	}

	return env.DEMO_RUNS.getByName(runId);
}

export function getDemoRateLimitStub(rateLimitKey: string) {
	if (!isDemoRateLimitKey(rateLimitKey)) {
		throw new DemoApiError({
			message: "Demo rate limit key is invalid.",
			status: 400,
		});
	}

	if (!env.DEMO_RUNS) {
		throw new DemoApiError({
			message: "DEMO_RUNS binding is not configured.",
			status: 500,
		});
	}

	return env.DEMO_RUNS.getByName(rateLimitKey);
}

export async function loadRunRecord(
	runId: string,
): Promise<DemoRunRecord | null> {
	const response = await getDemoRunStub(runId).fetch(
		"https://demo.internal/state",
	);
	if (response.status === 404) {
		return null;
	}

	const payload = (await response.json()) as {
		data: DemoRunRecord | null;
		error: { message: string } | null;
	};

	if (!response.ok) {
		throw new DemoApiError({
			message: payload.error?.message ?? "Failed to load demo run.",
			status: response.status,
		});
	}

	return payload.data;
}

export async function persistRunSession({
	runId,
	sessionId,
	shareFields,
	verificationUrl,
}: {
	runId: string;
	sessionId: string;
	shareFields: NonNullable<DemoRunRecord["share_fields"]>;
	verificationUrl: string;
}): Promise<void> {
	await getDemoRunStub(runId).fetch("https://demo.internal/session", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			session_id: sessionId,
			share_fields: shareFields,
			verification_url: verificationUrl,
		}),
	});
}

export async function persistRunStatus({
	runId,
	sessionStatus,
}: {
	runId: string;
	sessionStatus: NonNullable<DemoRunView["session_status"]>;
}): Promise<void> {
	await getDemoRunStub(runId).fetch("https://demo.internal/session-status", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(sessionStatus),
	});
}

export function toErrorResponse(error: unknown): Response {
	if (error instanceof DemoApiError) {
		return createJsonResponse(
			{
				data: null,
				error: {
					code: error.code,
					hint: error.hint,
					message: error.message,
				},
			},
			{ status: error.status },
		);
	}

	return createJsonResponse(
		{
			data: null,
			error: {
				code: "INTERNAL_ERROR",
				message: "Unexpected demo error.",
			},
		},
		{ status: 500 },
	);
}
