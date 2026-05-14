import { afterEach, expect, mock, test } from "bun:test";
import {
	BIOMETRIC_VERIFIER_AUTH_HEADER,
	BIOMETRIC_VERIFIER_DG2_FIELD,
	BIOMETRIC_VERIFIER_VIDEO_FIELD,
} from "@kayle-id/config/biometric-verifier";
import { verifyLiveness } from "@/v1/verify/biometric-verifier-client";
import { createMockFetch } from "../helpers/mock-fetch";

const originalFetch = globalThis.fetch;

function requireCapturedValue(value: string | null, label: string): string {
	if (value === null) {
		throw new Error(`Expected ${label} to be captured`);
	}

	return value;
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	mock.restore();
});

test("verifyLiveness uses the biometric verifier HTTP contract", async () => {
	let capturedThisValue: unknown = null;
	let capturedUrl: string | null = null;
	let capturedAuthHeader: string | null = null;
	let capturedDg2Size = 0;
	let capturedVideoSize = 0;

	const verifierBinding = {
		async fetch(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
			const request = new Request(input, init);
			const formData = await request.formData();

			capturedThisValue = this;
			capturedUrl = request.url;
			capturedAuthHeader = request.headers.get(BIOMETRIC_VERIFIER_AUTH_HEADER);
			capturedDg2Size = (
				await (formData.get(BIOMETRIC_VERIFIER_DG2_FIELD) as Blob).arrayBuffer()
			).byteLength;
			capturedVideoSize = (
				await (
					formData.get(BIOMETRIC_VERIFIER_VIDEO_FIELD) as Blob
				).arrayBuffer()
			).byteLength;

			return new Response(
				JSON.stringify({
					livenessPassed: true,
					livenessScore: 0.95,
					faceMatchPassed: true,
					faceMatchScore: 0.91,
					faceMatchAlignment: "mesh",
					padPassed: true,
					padScore: 0.82,
					usedFallback: false,
				}),
				{
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				},
			);
		},
	};

	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01, 0x02, 0x03]),
		video: new Uint8Array([0x10, 0x11, 0x12, 0x13]),
		env: {
			BIOMETRIC_VERIFIER: verifierBinding,
			BIOMETRIC_VERIFIER_SECRET: "test-secret",
		},
		faceMatchThreshold: 0.8,
	});

	expect(result.livenessPassed).toBeTrue();
	expect(result.faceMatchPassed).toBeTrue();
	expect(result.padPassed).toBeTrue();
	expect(result.padScore).toBe(0.82);
	expect(
		requireCapturedValue(capturedUrl, "biometric verifier request URL"),
	).toBe("https://biometric-verifier.internal/verify");
	if (capturedThisValue !== verifierBinding) {
		throw new Error(
			"Expected biometric verifier binding fetch to retain its receiver",
		);
	}
	expect(
		requireCapturedValue(capturedAuthHeader, "biometric verifier auth header"),
	).toBe("test-secret");
	expect(capturedDg2Size).toBe(3);
	expect(capturedVideoSize).toBe(4);
});

test("verifyLiveness fails closed when verifier config is unavailable", async () => {
	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01, 0x02, 0x03]),
		video: new Uint8Array([0x04, 0x05]),
		env: {},
	});

	expect(result).toEqual({
		livenessPassed: false,
		livenessScore: null,
		faceMatchPassed: false,
		faceMatchScore: null,
		padPassed: false,
		padScore: null,
		usedFallback: true,
		reason: "biometric_verifier_unavailable",
	});
});

test("verifyLiveness fails closed when the verifier binding is set but the secret is missing", async () => {
	let verifierCalled = false;

	const verifierBinding = {
		fetch(_input: RequestInfo | URL, _init?: RequestInit) {
			verifierCalled = true;

			return new Response(
				JSON.stringify({
					livenessPassed: true,
					livenessScore: 0.9,
					faceMatchPassed: true,
					faceMatchScore: 0.9,
					faceMatchAlignment: "mesh",
					padPassed: true,
					padScore: 0.85,
					usedFallback: false,
				}),
				{
					headers: {
						"content-type": "application/json",
					},
					status: 200,
				},
			);
		},
	};

	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01, 0x02, 0x03]),
		video: new Uint8Array([0x04, 0x05]),
		env: {
			BIOMETRIC_VERIFIER: verifierBinding,
		},
	});

	expect(result.reason).toBe("biometric_verifier_misconfigured");
	expect(verifierCalled).toBe(false);
});

test("verifyLiveness fails closed when the verifier returns invalid JSON", async () => {
	globalThis.fetch = createMockFetch(
		async () =>
			new Response("not-json", {
				headers: {
					"content-type": "application/json",
				},
				status: 200,
			}),
	);

	const result = await verifyLiveness({
		dg2Image: new Uint8Array([0x01]),
		video: new Uint8Array([0x02]),
		env: {
			BIOMETRIC_VERIFIER: {
				fetch: globalThis.fetch,
			},
			BIOMETRIC_VERIFIER_SECRET: "test-secret",
		},
	});

	expect(result.reason).toBe("biometric_verifier_unavailable");
});
