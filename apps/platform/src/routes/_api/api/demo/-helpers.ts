import { env } from "@/config/env";
import { DemoApiError } from "@/demo/api";
import type { DemoRunRecord, DemoRunView } from "@/demo/types";

export function createJsonResponse(
	body: unknown,
	init?: ResponseInit,
): Response {
	return Response.json(body, init);
}

export function createRandomToken(length: number): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const random = new Uint8Array(length);
	crypto.getRandomValues(random);

	let output = "";
	for (const value of random) {
		output += alphabet[value % alphabet.length];
	}

	return output;
}

export function createDemoRunId(): string {
	return `demo_${crypto.randomUUID().replaceAll("-", "")}`;
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
				message:
					error instanceof Error ? error.message : "Unexpected demo error.",
			},
		},
		{ status: 500 },
	);
}
