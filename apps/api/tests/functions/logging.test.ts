import { expect, test } from "bun:test";
import {
	buildSafeErrorContext,
	createSafeRequestLogger,
	logEvent,
	logSafeError,
	type SafeRequestLogger,
} from "@kayle-id/config/logging";
import { verifyLiveness } from "@/v1/verify/biometric-verifier-client";

type LoggedCall = {
	context: Record<string, unknown>;
	message: string;
};

type MockLogger = SafeRequestLogger & {
	infoCalls: LoggedCall[];
	warnCalls: LoggedCall[];
};

function createMockLogger(): MockLogger {
	const context: Record<string, unknown> = {};
	const infoCalls: LoggedCall[] = [];
	const warnCalls: LoggedCall[] = [];

	return {
		emit: () => null,
		getContext: () => ({ ...context }),
		info: (message, nextContext) => {
			infoCalls.push({
				context: nextContext ?? {},
				message,
			});
			Object.assign(context, nextContext ?? {});
		},
		infoCalls,
		set: (nextContext) => {
			Object.assign(context, nextContext);
		},
		warn: (message, nextContext) => {
			warnCalls.push({
				context: nextContext ?? {},
				message,
			});
			Object.assign(context, nextContext ?? {});
		},
		warnCalls,
	};
}

test("createSafeRequestLogger strips query strings and does not include extra request metadata", () => {
	const request = new Request(
		"https://api.kayle.id/v1/verify/session/vs_123?token=secret-value",
	);

	Reflect.set(request, "cf", {
		asn: 13_335,
		colo: "LHR",
		country: "GB",
	});

	const logger = createSafeRequestLogger({
		headers: new Headers({
			"cf-ray": "ray-123",
			traceparent: "trace-123",
			"user-agent": "test-agent",
		}),
		method: request.method,
		path: request.url,
	});

	expect(logger.getContext()).toEqual(
		expect.objectContaining({
			method: "GET",
			path: "/v1/verify/session/vs_123",
			request_id: "ray-123",
		}),
	);
	expect(logger.getContext()).not.toHaveProperty("asn");
	expect(logger.getContext()).not.toHaveProperty("colo");
	expect(logger.getContext()).not.toHaveProperty("country");
	expect(logger.getContext()).not.toHaveProperty("requestHeaders");
	expect(logger.getContext()).not.toHaveProperty("traceparent");
});

test("createSafeRequestLogger accepts a Request instance", () => {
	const request = new Request(
		"https://api.kayle.id/v1/verify/session/vs_456?token=secret-value",
		{
			headers: {
				"x-request-id": "req-456",
			},
			method: "POST",
		},
	);

	const logger = createSafeRequestLogger(request);

	expect(logger.getContext()).toEqual(
		expect.objectContaining({
			method: "POST",
			path: "/v1/verify/session/vs_456",
			request_id: "req-456",
		}),
	);
});

test("buildSafeErrorContext uses explicit safe messages", () => {
	const unsafeError = new Error("token=secret-value");
	unsafeError.name = "SyntaxError";

	expect(
		buildSafeErrorContext({
			code: "biometric_verifier_invalid_json",
			error: unsafeError,
			message: "Biometric verifier returned invalid JSON.",
		}),
	).toEqual({
		error_code: "biometric_verifier_invalid_json",
		error_message: "Biometric verifier returned invalid JSON.",
		error_name: "SyntaxError",
	});
});

test("logEvent includes the event in info log context", () => {
	const logger = createMockLogger();

	logEvent(logger, {
		details: {
			duration_ms: 12,
		},
		event: "verify.biometric_verifier.request_succeeded",
	});

	expect(logger.infoCalls[0]).toEqual({
		context: {
			duration_ms: 12,
			event: "verify.biometric_verifier.request_succeeded",
		},
		message: "verify.biometric_verifier.request_succeeded",
	});
});

test("logSafeError emits safe warn events", () => {
	const logger = createMockLogger();
	const unsafeError = new Error("token=secret-value");
	unsafeError.name = "SyntaxError";

	logSafeError(logger, {
		code: "biometric_verifier_invalid_json",
		details: {
			duration_ms: 12,
		},
		error: unsafeError,
		event: "verify.biometric_verifier.invalid_json",
		message: "Biometric verifier returned invalid JSON.",
	});

	expect(logger.warnCalls[0]).toEqual({
		context: expect.objectContaining({
			duration_ms: 12,
			error_code: "biometric_verifier_invalid_json",
			error_message: "Biometric verifier returned invalid JSON.",
			error_name: "SyntaxError",
			event: "verify.biometric_verifier.invalid_json",
		}),
		message: "verify.biometric_verifier.invalid_json",
	});
	expect(logger.warnCalls[0]?.context).not.toHaveProperty("error_stack");
});

test("verifyLiveness does not log upstream response bodies on HTTP errors", async () => {
	const logger = createMockLogger();

	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01, 0x02]),
		video: new Uint8Array([0x03, 0x04]),
		poseSequence: ["center", "left", "right"],
		env: {
			BIOMETRIC_VERIFIER: {
				fetch: async () =>
					new Response("secret=should-not-be-logged", {
						status: 503,
					}),
			},
			BIOMETRIC_VERIFIER_SECRET: "test-secret",
		},
		logger,
	});

	expect(result.livenessPassed).toBeFalse();
	expect(result.reason).toBe("biometric_verifier_unavailable");
	expect(logger.warnCalls[0]).toEqual({
		context: expect.objectContaining({
			duration_ms: expect.any(Number),
			error_code: "biometric_verifier_http_error",
			event: "verify.biometric_verifier.http_error",
			status: 503,
		}),
		message: "verify.biometric_verifier.http_error",
	});
	expect(logger.warnCalls[0]?.context).not.toHaveProperty("response_text");
});

test("verifyLiveness logs safe invalid JSON errors without raw parser messages", async () => {
	const logger = createMockLogger();

	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01, 0x02]),
		video: new Uint8Array([0x03, 0x04]),
		poseSequence: ["center", "left", "right"],
		env: {
			BIOMETRIC_VERIFIER: {
				fetch: async () =>
					new Response("not-json", {
						headers: {
							"content-type": "application/json",
						},
						status: 200,
					}),
			},
			BIOMETRIC_VERIFIER_SECRET: "test-secret",
		},
		logger,
	});

	expect(result.livenessPassed).toBeFalse();
	expect(result.reason).toBe("biometric_verifier_unavailable");
	expect(logger.warnCalls[0]).toEqual({
		context: expect.objectContaining({
			duration_ms: expect.any(Number),
			error_code: "biometric_verifier_invalid_json",
			error_message: "Biometric verifier returned invalid JSON.",
			error_name: "SyntaxError",
			event: "verify.biometric_verifier.invalid_json",
		}),
		message: "verify.biometric_verifier.invalid_json",
	});
	expect(logger.warnCalls[0]?.context).not.toHaveProperty("error_stack");
});
