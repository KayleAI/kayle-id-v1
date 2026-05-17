import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import {
	events,
	verification_attempts,
	verification_consents,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import {
	webhook_deliveries,
	webhook_endpoints,
} from "@kayle-id/database/schema/webhooks";
import { and, eq } from "drizzle-orm";
import { createHMAC } from "@/functions/hmac";
import app from "@/index";
import v1 from "@/v1";
import {
	deriveAttestHelloChallenge,
	deriveAttestNfcChallenge,
} from "@/v1/verify/attest-challenges";
import { issueHandoffPayload } from "@/v1/verify/handoff";
import { setup, type TestData, teardown } from "./setup";

let TEST_DATA: TestData | undefined;
const VALID_SHAPED_WRONG_CANCEL_TOKEN = "a".repeat(48);

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

type HandoffResponse = {
	data: {
		v: number;
		session_id: string;
		attempt_id: string;
		attest_hello_challenge: string;
		attest_nfc_challenge: string;
		mobile_write_token: string;
		expires_at: string;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/u, "");
}

type VerifySessionStatusResponse = {
	data: {
		completed_at: string | null;
		is_terminal: boolean;
		latest_attempt: {
			completed_at: string | null;
			failure_code: string | null;
			handoff_claimed: boolean;
			id: string;
			retry_allowed: boolean;
			status: "cancelled" | "failed" | "in_progress" | "succeeded";
		} | null;
		redirect_url: string | null;
		session_id: string;
		same_device_only: boolean;
		status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

type VerifySessionDetailsResponse = {
	data: {
		organization_name: string;
		organization_owner_id_check_completed: boolean;
		organization_verified_apex_domains: string[];
		organization_logo: string | null;
		organization_business_type: "sole" | "business" | null;
		organization_business_name: string | null;
		organization_business_jurisdiction: string | null;
		organization_business_registration_number: string | null;
		organization_privacy_policy_url: string | null;
		organization_terms_of_service_url: string | null;
		organization_website: string | null;
		organization_description: string | null;
		session_id: string;
		is_age_only: boolean;
		age_threshold: number | null;
		share_fields: Record<
			string,
			{ reason: string; required: boolean; source: "default" | "rc" }
		>;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

type ConsentResponse = {
	data: {
		consent_id: string;
		consented_at: string;
	} | null;
	error: {
		code: string;
		message: string;
	} | null;
};

async function createSession({
	redirectUrl,
}: {
	redirectUrl?: string;
} = {}): Promise<string> {
	const { sessionId } = await createSessionWithCancelToken({ redirectUrl });
	return sessionId;
}

async function createSessionWithCancelToken({
	redirectUrl,
}: {
	redirectUrl?: string;
} = {}): Promise<{ sessionId: string; cancelToken: string }> {
	const response = await v1.request("/sessions", {
		body: redirectUrl
			? JSON.stringify({
					redirect_url: redirectUrl,
				})
			: undefined,
		headers: {
			Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			...(redirectUrl ? { "Content-Type": "application/json" } : {}),
		},
		method: "POST",
	});

	if (response.status !== 200) {
		throw new Error(
			`Expected session creation to return 200, received ${response.status}`,
		);
	}

	const payload = (await response.json()) as {
		data: { id: string; cancel_token?: string };
	};

	if (!payload.data?.id) {
		throw new Error("Session creation response is missing data.id");
	}

	if (!payload.data.cancel_token) {
		throw new Error("Session creation response is missing data.cancel_token");
	}

	return {
		sessionId: payload.data.id,
		cancelToken: payload.data.cancel_token,
	};
}

async function recordConsent(sessionId: string): Promise<string> {
	const response = await app.request(
		`/v1/verify/session/${sessionId}/consent`,
		{
			body: JSON.stringify({
				biometric_consent: true,
				document_processing_consent: true,
				privacy_notice_acknowledged: true,
				share_claims_consent: true,
				terms_acknowledged: true,
			}),
			headers: {
				"Content-Type": "application/json",
			},
			method: "POST",
		},
	);

	expect(response.status).toBe(200);
	const payload = (await response.json()) as ConsentResponse;
	expect(payload.error).toBeNull();
	if (!payload.data?.consent_id) {
		throw new Error("Expected consent response to include consent_id");
	}

	return payload.data.consent_id;
}

describe("/v1/verify/session/:id/handoff", () => {
	test.serial("Returns 400 for invalid session ID", async () => {
		const response = await app.request(
			"/v1/verify/session/not-a-session/handoff",
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("INVALID_SESSION_ID");
	});

	test.serial("Returns 404 for unknown session", async () => {
		const unknownSessionId =
			"vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";

		const response = await app.request(
			`/v1/verify/session/${unknownSessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
	});

	test.serial("Returns 410 for cancelled sessions", async () => {
		const sessionId = await createSession();

		const cancelResponse = await v1.request(`/sessions/${sessionId}/cancel`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
			},
		});
		expect(cancelResponse.status).toBe(204);

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(410);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_EXPIRED");
	});

	test.serial("Returns 409 for in-progress sessions", async () => {
		const sessionId = await createSession();

		await db
			.update(verification_sessions)
			.set({ status: "in_progress" })
			.where(eq(verification_sessions.id, sessionId));

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(409);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("SESSION_IN_PROGRESS");
	});

	test.serial("Returns 409 before browser consent is recorded", async () => {
		const sessionId = await createSession();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(409);
		const payload = (await response.json()) as HandoffResponse;
		expect(payload.error?.code).toBe("CONSENT_REQUIRED");
	});

	test.serial("Creates handoff payload and persists token hash", async () => {
		if (!TEST_DATA) {
			throw new Error("Test data not initialized");
		}

		const sessionId = await createSession();
		const consentId = await recordConsent(sessionId);

		const response = await app.request(
			`/v1/verify/session/${sessionId}/handoff`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as HandoffResponse;

		expect(payload.error).toBeNull();
		expect(payload.data?.v).toBe(1);
		expect(payload.data?.session_id).toBe(sessionId);
		expect(payload.data?.attempt_id).toBeDefined();
		expect(payload.data?.mobile_write_token).toBeDefined();
		expect(payload.data?.expires_at).toBeDefined();

		if (!payload.data?.attempt_id) {
			throw new Error("Expected handoff payload to include an attempt ID");
		}

		const expectedHelloChallenge = await deriveAttestHelloChallenge({
			attemptId: payload.data.attempt_id,
			authSecret: env.AUTH_SECRET,
		});
		const expectedNfcChallenge = await deriveAttestNfcChallenge({
			attemptId: payload.data.attempt_id,
			authSecret: env.AUTH_SECRET,
		});
		expect(payload.data.attest_hello_challenge).toBe(
			bytesToBase64Url(expectedHelloChallenge),
		);
		expect(payload.data.attest_nfc_challenge).toBe(
			bytesToBase64Url(expectedNfcChallenge),
		);

		const [attempt] = await db
			.select()
			.from(verification_attempts)
			.where(
				and(
					eq(verification_attempts.id, payload.data?.attempt_id ?? ""),
					eq(verification_attempts.verificationSessionId, sessionId),
				),
			)
			.limit(1);

		expect(attempt).toBeDefined();
		expect(attempt?.mobileWriteTokenSeed).toBeDefined();
		expect(attempt?.mobileWriteTokenSeed).not.toBe(
			payload.data?.mobile_write_token,
		);
		expect(attempt?.mobileWriteTokenHash).toBeDefined();
		expect(attempt?.mobileWriteTokenHash).not.toBe(
			payload.data?.mobile_write_token,
		);
		expect(attempt?.mobileWriteTokenIssuedAt).not.toBeNull();
		expect(attempt?.mobileWriteTokenExpiresAt).not.toBeNull();

		const expectedHash = await createHMAC(
			payload.data?.mobile_write_token ?? "",
			{
				secret: env.AUTH_SECRET,
			},
		);
		expect(attempt?.mobileWriteTokenHash).toBe(expectedHash);

		const [consent] = await db
			.select({
				verificationAttemptId: verification_consents.verificationAttemptId,
			})
			.from(verification_consents)
			.where(eq(verification_consents.id, consentId))
			.limit(1);

		expect(consent?.verificationAttemptId).toBe(payload.data.attempt_id);
	});

	test.serial(
		"Reuses an unclaimed handoff until the token expires",
		async () => {
			const sessionId = await createSession();
			await recordConsent(sessionId);

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(200);
			const firstPayload = (await firstResponse.json()) as HandoffResponse;
			const firstAttemptId = firstPayload.data?.attempt_id;

			const [firstAttempt] = await db
				.select({
					mobileWriteTokenIssuedAt:
						verification_attempts.mobileWriteTokenIssuedAt,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, firstAttemptId ?? ""))
				.limit(1);
			const issuedAt = firstAttempt?.mobileWriteTokenIssuedAt;
			if (!issuedAt) {
				throw new Error("Expected handoff attempt to have an issued timestamp");
			}

			const secondPayload = await issueHandoffPayload(sessionId, {
				now: new Date(issuedAt.getTime() + 61_000),
			});
			if (!secondPayload.ok) {
				throw new Error(
					`Expected handoff reuse, received ${secondPayload.error.code}`,
				);
			}

			expect(secondPayload.data.attempt_id).toBe(firstAttemptId ?? "");
			expect(secondPayload.data.expires_at).toBe(
				firstPayload.data?.expires_at ?? "",
			);
			expect(secondPayload.data.mobile_write_token).toBe(
				firstPayload.data?.mobile_write_token ?? "",
			);
		},
	);

	test.serial(
		"Issues a new attempt after the active handoff token expires",
		async () => {
			const sessionId = await createSession();
			await recordConsent(sessionId);

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(200);
			const firstPayload = (await firstResponse.json()) as HandoffResponse;
			const firstAttemptId = firstPayload.data?.attempt_id;

			await db
				.update(verification_attempts)
				.set({
					mobileWriteTokenExpiresAt: new Date(Date.now() - 1_000),
				})
				.where(eq(verification_attempts.id, firstAttemptId ?? ""));

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(secondResponse.status).toBe(200);
			const secondPayload = (await secondResponse.json()) as HandoffResponse;

			expect(secondPayload.data?.attempt_id).not.toBe(firstAttemptId);
		},
	);

	test.serial(
		"Blocks new handoff issuance after a token is claimed",
		async () => {
			const sessionId = await createSession();
			await recordConsent(sessionId);

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(200);
			const firstPayload = (await firstResponse.json()) as HandoffResponse;

			await db
				.update(verification_attempts)
				.set({
					mobileWriteTokenConsumedAt: new Date(),
				})
				.where(
					eq(verification_attempts.id, firstPayload.data?.attempt_id ?? ""),
				);

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/handoff`,
				{
					method: "POST",
				},
			);

			expect(secondResponse.status).toBe(409);
			const secondPayload = (await secondResponse.json()) as HandoffResponse;
			expect(secondPayload.error?.code).toBe("SESSION_IN_PROGRESS");
		},
	);
});

describe("/v1/verify/session/:id/consent", () => {
	test.serial("Persists browser consent before handoff", async () => {
		const sessionId = await createSession();
		const consentId = await recordConsent(sessionId);

		const [consent] = await db
			.select()
			.from(verification_consents)
			.where(eq(verification_consents.id, consentId))
			.limit(1);

		expect(consent).toBeDefined();
		expect(consent?.verificationSessionId).toBe(sessionId);
		expect(consent?.verificationAttemptId).toBeNull();
		expect(consent?.documentProcessingConsent).toBe(true);
		expect(consent?.biometricConsent).toBe(true);
		expect(consent?.shareClaimsConsent).toBe(true);
		expect(consent?.termsAcknowledged).toBe(true);
		expect(consent?.privacyNoticeAcknowledged).toBe(true);
		expect(consent?.rpName).toBe("Test Organization");
		expect(consent?.requestedClaimKeys).toContain("kayle_document_id");
		expect(consent?.requiredClaimKeys).toContain("kayle_document_id");
		expect(consent?.selectedClaimKeys).toEqual(consent?.requestedClaimKeys);
		expect(consent?.shareContractHash).toHaveLength(64);
	});

	test.serial(
		"Rejects consent requests missing separate acknowledgements",
		async () => {
			const sessionId = await createSession();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/consent`,
				{
					body: JSON.stringify({
						document_processing_consent: true,
					}),
					headers: {
						"Content-Type": "application/json",
					},
					method: "POST",
				},
			);

			expect(response.status).toBe(400);
			const payload = (await response.json()) as ConsentResponse;
			expect(payload.error?.code).toBe("INVALID_REQUEST");
		},
	);
});

describe("/v1/verify/session/:id/status", () => {
	test.serial(
		"Returns 400 for invalid session ID details requests",
		async () => {
			const response = await app.request(
				"/v1/verify/session/not-a-session/details",
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(400);
			const payload = (await response.json()) as VerifySessionDetailsResponse;
			expect(payload.error?.code).toBe("INVALID_SESSION_ID");
		},
	);

	test.serial(
		"Returns the public session details with organization name",
		async () => {
			const sessionId = await createSession();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/details`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionDetailsResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toMatchObject({
				organization_name: "Test Organization",
				organization_owner_id_check_completed: true,
				organization_verified_apex_domains: [
					...(TEST_DATA?.verifiedApexDomains ?? []),
				].sort(),
				organization_logo: null,
				organization_business_name: null,
				organization_business_jurisdiction: null,
				organization_business_registration_number: null,
				organization_business_type: null,
				organization_privacy_policy_url: null,
				organization_terms_of_service_url: null,
				organization_website: null,
				organization_description: null,
				session_id: sessionId,
				is_age_only: false,
				age_threshold: null,
			});
			expect(payload.data?.share_fields.kayle_document_id).toMatchObject({
				required: true,
				source: "default",
			});
		},
	);

	test.serial("Returns the age threshold for age-only sessions", async () => {
		const sessionResponse = await v1.request("/sessions", {
			body: JSON.stringify({
				share_fields: { age_over_21: { required: true, reason: "Bar entry" } },
			}),
			headers: {
				Authorization: `Bearer ${TEST_DATA?.apiKey}`,
				"Content-Type": "application/json",
			},
			method: "POST",
		});
		expect(sessionResponse.status).toBe(200);
		const sessionPayload = (await sessionResponse.json()) as {
			data: { id: string };
		};
		const ageOnlySessionId = sessionPayload.data.id;

		const response = await app.request(
			`/v1/verify/session/${ageOnlySessionId}/details`,
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as VerifySessionDetailsResponse;

		expect(payload.error).toBeNull();
		expect(payload.data).toMatchObject({
			is_age_only: true,
			age_threshold: 21,
			share_fields: {
				age_over_21: {
					required: true,
					source: "rc",
				},
			},
		});
	});

	test.serial(
		"Cancels a live verification session via the public verify route",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(204);

			const [session] = await db
				.select({
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			expect(session?.status).toBe("cancelled");
		},
	);

	test.serial("Rejects public cancel without a cancel_token", async () => {
		const { sessionId } = await createSessionWithCancelToken();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/cancel`,
			{
				method: "POST",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("INVALID_REQUEST");
	});

	test.serial(
		"Rejects public cancel with a malformed cancel_token",
		async () => {
			const { sessionId } = await createSessionWithCancelToken();

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: "ct_wrong_value" }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(400);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("INVALID_REQUEST");
		},
	);

	test.serial("Rejects public cancel with the wrong cancel_token", async () => {
		const { sessionId } = await createSessionWithCancelToken();

		const response = await app.request(
			`/v1/verify/session/${sessionId}/cancel`,
			{
				body: JSON.stringify({
					cancel_token: VALID_SHAPED_WRONG_CANCEL_TOKEN,
				}),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			},
		);

		expect(response.status).toBe(401);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("CANCEL_TOKEN_INVALID");
	});

	test.serial(
		"Rejects a consumed public cancel token while the session is active",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();

			await db
				.update(verification_sessions)
				.set({ cancelTokenConsumedAt: new Date() })
				.where(eq(verification_sessions.id, sessionId));

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(401);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("CANCEL_TOKEN_USED");
		},
	);

	test.serial(
		"Rejects public cancel with a token bound to a different session",
		async () => {
			const { sessionId: targetSessionId } =
				await createSessionWithCancelToken();
			const { cancelToken: foreignToken } =
				await createSessionWithCancelToken();

			const response = await app.request(
				`/v1/verify/session/${targetSessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: foreignToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(401);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("CANCEL_TOKEN_INVALID");
		},
	);

	test.serial(
		"Public cancel is idempotent on the same token after a successful cancel",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();

			const firstResponse = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);
			expect(firstResponse.status).toBe(204);

			const secondResponse = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);
			expect(secondResponse.status).toBe(204);
		},
	);

	test.serial(
		"Public cancel records a privacy request and scrubs undelivered completed-check webhooks",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const attemptId = "va_privacy_request_completed";
			const eventId = "evt_privacy_request_completed";
			const endpointId = "whe_privacy_request_completed";
			const deliveryId = "whd_privacy_request_completed";

			await db
				.update(verification_sessions)
				.set({
					completedAt,
					status: "completed",
				})
				.where(eq(verification_sessions.id, sessionId));
			await db.insert(verification_attempts).values({
				id: attemptId,
				verificationSessionId: sessionId,
				completedAt,
				mobileHelloDeviceIdHash: "device_hash",
				mobileWriteTokenConsumedAt: completedAt,
				riskScore: 0.73,
				selectedShareFieldKeys: ["family_name"],
				status: "succeeded",
			});
			await db.insert(webhook_endpoints).values({
				id: endpointId,
				organizationId: TEST_DATA?.organizationId ?? "",
				subscribedEventTypes: ["verification.attempt.succeeded"],
				url: "https://example.com/privacy-request",
			});
			await db.insert(events).values({
				id: eventId,
				organizationId: TEST_DATA?.organizationId ?? "",
				triggerId: attemptId,
				triggerType: "verification_attempt",
				type: "verification.attempt.succeeded",
			});
			await db.insert(webhook_deliveries).values({
				eventId,
				id: deliveryId,
				payload: "encrypted-claims-payload",
				payloadExpiresAt: new Date("2099-01-02T00:00:00.000Z"),
				payloadRetentionReason: "pending_delivery",
				status: "pending",
				webhookEndpointId: endpointId,
				webhookEncryptionKeyId: null,
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(204);

			const [delivery] = await db
				.select()
				.from(webhook_deliveries)
				.where(eq(webhook_deliveries.id, deliveryId))
				.limit(1);
			const [attempt] = await db
				.select()
				.from(verification_attempts)
				.where(eq(verification_attempts.id, attemptId))
				.limit(1);
			const [session] = await db
				.select()
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);
			const [privacyAudit] = await db
				.select()
				.from(audit_logs)
				.where(
					and(
						eq(audit_logs.organizationId, TEST_DATA?.organizationId ?? ""),
						eq(audit_logs.event, "session.privacy_request.submitted"),
						eq(audit_logs.targetId, sessionId),
					),
				)
				.limit(1);

			expect(delivery?.payload).toBeNull();
			expect(delivery?.payloadExpiresAt).toBeNull();
			expect(delivery?.payloadRetentionReason).toBe("privacy_request");
			expect(delivery?.payloadScrubbedAt).not.toBeNull();
			expect(delivery?.status).toBe("failed");
			expect(attempt?.status).toBe("cancelled");
			expect(attempt?.failureCode).toBe("session_cancelled");
			expect(attempt?.mobileHelloDeviceIdHash).toBeNull();
			expect(attempt?.mobileWriteTokenConsumedAt).toBeNull();
			expect(attempt?.riskScore).toBe(0);
			expect(attempt?.selectedShareFieldKeys).toEqual([]);
			expect(session?.status).toBe("cancelled");
			expect(privacyAudit?.metadata).toMatchObject({
				delivered_webhook_delivery_count: 0,
				minimized_completed_attempt_count: 1,
				scrubbed_webhook_payload_count: 1,
				session_status_at_request: "completed",
				total_webhook_delivery_count: 1,
			});
		},
	);

	test.serial(
		"Public cancel records delivered privacy requests without replayable payloads",
		async () => {
			const { sessionId, cancelToken } = await createSessionWithCancelToken();
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const attemptId = "va_privacy_request_delivered";
			const eventId = "evt_privacy_request_delivered";
			const endpointId = "whe_privacy_request_delivered";
			const deliveryId = "whd_privacy_request_delivered";

			await db
				.update(verification_sessions)
				.set({
					completedAt,
					status: "completed",
				})
				.where(eq(verification_sessions.id, sessionId));
			await db.insert(verification_attempts).values({
				id: attemptId,
				verificationSessionId: sessionId,
				completedAt,
				mobileHelloDeviceIdHash: "device_hash",
				mobileWriteTokenConsumedAt: completedAt,
				riskScore: 0.81,
				selectedShareFieldKeys: ["family_name"],
				status: "succeeded",
			});
			await db.insert(webhook_endpoints).values({
				id: endpointId,
				organizationId: TEST_DATA?.organizationId ?? "",
				subscribedEventTypes: ["verification.attempt.succeeded"],
				url: "https://example.com/privacy-request-delivered",
			});
			await db.insert(events).values({
				id: eventId,
				organizationId: TEST_DATA?.organizationId ?? "",
				triggerId: attemptId,
				triggerType: "verification_attempt",
				type: "verification.attempt.succeeded",
			});
			await db.insert(webhook_deliveries).values({
				eventId,
				id: deliveryId,
				payload: null,
				payloadRetentionReason: "delivered",
				payloadScrubbedAt: completedAt,
				status: "succeeded",
				webhookEndpointId: endpointId,
				webhookEncryptionKeyId: null,
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/cancel`,
				{
					body: JSON.stringify({ cancel_token: cancelToken }),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(204);

			const [delivery] = await db
				.select()
				.from(webhook_deliveries)
				.where(eq(webhook_deliveries.id, deliveryId))
				.limit(1);
			const [attempt] = await db
				.select()
				.from(verification_attempts)
				.where(eq(verification_attempts.id, attemptId))
				.limit(1);
			const [session] = await db
				.select()
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);
			const [privacyAudit] = await db
				.select()
				.from(audit_logs)
				.where(
					and(
						eq(audit_logs.organizationId, TEST_DATA?.organizationId ?? ""),
						eq(audit_logs.event, "session.privacy_request.submitted"),
						eq(audit_logs.targetId, sessionId),
					),
				)
				.limit(1);

			expect(delivery?.payload).toBeNull();
			expect(delivery?.payloadRetentionReason).toBe("delivered");
			expect(delivery?.status).toBe("succeeded");
			expect(attempt?.status).toBe("succeeded");
			expect(attempt?.failureCode).toBeNull();
			expect(attempt?.mobileHelloDeviceIdHash).toBeNull();
			expect(attempt?.mobileWriteTokenConsumedAt).toBeNull();
			expect(attempt?.riskScore).toBe(0);
			expect(attempt?.selectedShareFieldKeys).toEqual([]);
			expect(session?.status).toBe("completed");
			expect(privacyAudit?.metadata).toMatchObject({
				delivered_webhook_delivery_count: 1,
				minimized_completed_attempt_count: 1,
				scrubbed_webhook_payload_count: 0,
				session_status_at_request: "completed",
				total_webhook_delivery_count: 1,
			});
		},
	);

	test.serial(
		"Returns 404 when cancelling an unknown verification session",
		async () => {
			const response = await app.request(
				"/v1/verify/session/vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/cancel",
				{
					body: JSON.stringify({
						cancel_token: VALID_SHAPED_WRONG_CANCEL_TOKEN,
					}),
					headers: { "Content-Type": "application/json" },
					method: "POST",
				},
			);

			expect(response.status).toBe(404);
			const payload = (await response.json()) as VerifySessionStatusResponse;
			expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
		},
	);

	test.serial("Returns 400 for invalid session ID", async () => {
		const response = await app.request(
			"/v1/verify/session/not-a-session/status",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(400);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("INVALID_SESSION_ID");
	});

	test.serial("Returns 404 for unknown session", async () => {
		const response = await app.request(
			"/v1/verify/session/vs_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/status",
			{
				method: "GET",
			},
		);

		expect(response.status).toBe(404);
		const payload = (await response.json()) as VerifySessionStatusResponse;
		expect(payload.error?.code).toBe("SESSION_NOT_FOUND");
	});

	test.serial(
		"Returns the terminal session payload with redirect URL and latest attempt",
		async () => {
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const redirectUrl = `https://${TEST_DATA?.verifiedApexDomains[0]}/return`;
			const sessionId = await createSession({ redirectUrl });

			await db
				.update(verification_sessions)
				.set({
					status: "completed",
					completedAt,
				})
				.where(eq(verification_sessions.id, sessionId));

			await db.insert(verification_attempts).values({
				id: "va_status_completed",
				verificationSessionId: sessionId,
				status: "succeeded",
				completedAt,
				mobileWriteTokenConsumedAt: completedAt,
				mobileHelloDeviceIdHash: "device_hash",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toEqual({
				completed_at: completedAt.toISOString(),
				is_terminal: true,
				latest_attempt: {
					completed_at: completedAt.toISOString(),
					failure_code: null,
					handoff_claimed: true,
					id: "va_status_completed",
					retry_allowed: false,
					status: "succeeded",
				},
				redirect_url: redirectUrl,
				session_id: sessionId,
				same_device_only: true,
				status: "completed",
			});
		},
	);

	test.serial(
		"Exposes same-device retry state after a failed claimed attempt",
		async () => {
			const completedAt = new Date("2099-01-01T00:00:00.000Z");
			const sessionId = await createSession();

			await db.insert(verification_attempts).values({
				id: "va_status_retryable_failed",
				verificationSessionId: sessionId,
				status: "failed",
				failureCode: "selfie_face_mismatch",
				completedAt,
				mobileWriteTokenConsumedAt: completedAt,
				mobileHelloDeviceIdHash: "device_hash",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data).toEqual({
				completed_at: null,
				is_terminal: false,
				latest_attempt: {
					completed_at: completedAt.toISOString(),
					failure_code: "selfie_face_mismatch",
					handoff_claimed: true,
					id: "va_status_retryable_failed",
					retry_allowed: true,
					status: "failed",
				},
				redirect_url: null,
				session_id: sessionId,
				same_device_only: true,
				status: "created",
			});
		},
	);

	test.serial(
		"Lazily normalizes expired sessions and updates the latest in-progress attempt",
		async () => {
			const expiredAt = new Date(Date.now() - 60_000);
			const sessionId = await createSession();

			await db
				.update(verification_sessions)
				.set({
					expiresAt: expiredAt,
				})
				.where(eq(verification_sessions.id, sessionId));

			await db.insert(verification_attempts).values({
				id: "va_status_expired",
				verificationSessionId: sessionId,
				status: "in_progress",
			});

			const response = await app.request(
				`/v1/verify/session/${sessionId}/status`,
				{
					method: "GET",
				},
			);

			expect(response.status).toBe(200);
			const payload = (await response.json()) as VerifySessionStatusResponse;

			expect(payload.error).toBeNull();
			expect(payload.data?.session_id).toBe(sessionId);
			expect(payload.data?.status).toBe("expired");
			expect(payload.data?.is_terminal).toBeTrue();
			expect(payload.data?.same_device_only).toBeFalse();
			expect(payload.data?.latest_attempt?.id).toBe("va_status_expired");
			expect(payload.data?.latest_attempt?.status).toBe("failed");
			expect(payload.data?.latest_attempt?.failure_code).toBe(
				"session_expired",
			);
			expect(payload.data?.latest_attempt?.handoff_claimed).toBeFalse();
			expect(payload.data?.latest_attempt?.retry_allowed).toBeFalse();

			const [session] = await db
				.select({
					completedAt: verification_sessions.completedAt,
					status: verification_sessions.status,
				})
				.from(verification_sessions)
				.where(eq(verification_sessions.id, sessionId))
				.limit(1);

			const [attempt] = await db
				.select({
					completedAt: verification_attempts.completedAt,
					failureCode: verification_attempts.failureCode,
					status: verification_attempts.status,
				})
				.from(verification_attempts)
				.where(eq(verification_attempts.id, "va_status_expired"))
				.limit(1);

			expect(session?.status).toBe("expired");
			expect(session?.completedAt).not.toBeNull();
			expect(attempt?.status).toBe("failed");
			expect(attempt?.failureCode).toBe("session_expired");
			expect(attempt?.completedAt).not.toBeNull();
		},
	);
});
