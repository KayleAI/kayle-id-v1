import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { recordAuditLog } from "@kayle-id/auth/audit-logs";
import { db } from "@kayle-id/database/drizzle";
import { audit_logs } from "@kayle-id/database/schema/audit-logs";
import { auth_organization_members } from "@kayle-id/database/schema/auth";
import {
	api_keys,
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, asc, desc, eq } from "drizzle-orm";
import { createApiKey } from "@/functions/auth/create-api-key";
import app from "@/index";
import { generateId } from "@/utils/generate-id";
import { markAttemptFailed } from "@/v1/verify/outcome";
import {
	type SessionAuthTestData,
	setActiveOrganizationOnSession,
	setupSessionAuth,
	teardownSessionAuth,
} from "./session-auth";

let OWNER_DATA: SessionAuthTestData | undefined;
let MEMBER_DATA: SessionAuthTestData | undefined;

interface AuditLogResponseRow {
	actor: {
		apiKeyId: string | null;
		apiKeyName: string | null;
		email: string | null;
		id: string | null;
		name: string | null;
		type: "user" | "system" | "api_key";
	};
	createdAt: string;
	event: string;
	id: string;
	metadata: Record<string, unknown>;
	targetId: string | null;
	targetType: string | null;
}

interface AuditLogsListResponse {
	data: AuditLogResponseRow[];
	error: null | { code: string; message: string };
	pagination: {
		has_more: boolean;
		limit: number;
		next_cursor: string | null;
	};
}

function jsonHeaders(cookie: string): HeadersInit {
	return { "Content-Type": "application/json", Cookie: cookie };
}

function requireOwnerData(): SessionAuthTestData & { organizationId: string } {
	if (!OWNER_DATA?.organizationId) {
		throw new Error("audit_logs_owner_data_missing");
	}
	return OWNER_DATA as SessionAuthTestData & { organizationId: string };
}

function requireMemberData(): SessionAuthTestData {
	if (!MEMBER_DATA) {
		throw new Error("audit_logs_member_data_missing");
	}
	return MEMBER_DATA;
}

beforeAll(async () => {
	OWNER_DATA = await setupSessionAuth({ withActiveOrganization: true });
	const owner = requireOwnerData();

	// Add a second user as a plain "member" of the same org so we can verify
	// that the listing endpoint refuses non-admin callers. We sign them up
	// without their own org, attach them to the owner's org, then point their
	// session at it via better-auth's setActiveOrganization.
	const member = await setupSessionAuth({ withActiveOrganization: false });
	await db.insert(auth_organization_members).values({
		createdAt: new Date(),
		organizationId: owner.organizationId,
		role: "member",
		userId: member.userId,
	});
	const refreshedCookie = await setActiveOrganizationOnSession({
		organizationId: owner.organizationId,
		sessionCookie: member.sessionCookie,
	});
	MEMBER_DATA = {
		organizationId: owner.organizationId,
		sessionCookie: refreshedCookie,
		userId: member.userId,
	};
});

afterAll(async () => {
	await teardownSessionAuth(MEMBER_DATA);
	MEMBER_DATA = undefined;
	await teardownSessionAuth(OWNER_DATA);
	OWNER_DATA = undefined;
});

afterEach(async () => {
	if (!OWNER_DATA?.organizationId) {
		return;
	}
	await db
		.delete(audit_logs)
		.where(eq(audit_logs.organizationId, OWNER_DATA.organizationId));
});

async function insertAuditLog(args: {
	actorApiKeyId?: string;
	actorType?: "system" | "user" | "api_key";
	actorUserId?: string;
	createdAt?: Date;
	event: string;
	organizationId: string;
	targetId?: string;
}): Promise<string> {
	const id = `aud_${crypto.randomUUID().replace(/-/g, "")}`;
	await db.insert(audit_logs).values({
		actorApiKeyId: args.actorApiKeyId ?? null,
		actorType: args.actorType ?? "system",
		actorUserId: args.actorUserId ?? null,
		createdAt: args.createdAt ?? new Date(),
		event: args.event,
		id,
		metadata: {},
		organizationId: args.organizationId,
		targetId: args.targetId ?? null,
	});
	return id;
}

describe("Audit logs listing endpoint", () => {
	test("admin/owner can list rows for their org", async () => {
		const owner = requireOwnerData();
		const id = await insertAuditLog({
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request("/v1/auth/orgs/audit-logs", {
			headers: jsonHeaders(owner.sessionCookie),
			method: "GET",
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.error).toBeNull();
		expect(payload.data.map((row) => row.id)).toContain(id);
	});

	test("non-admin member is forbidden", async () => {
		const member = requireMemberData();
		const response = await app.request("/v1/auth/orgs/audit-logs", {
			headers: jsonHeaders(member.sessionCookie),
			method: "GET",
		});
		expect(response.status).toBe(403);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.error?.code).toBe("FORBIDDEN");
	});

	test("unauthenticated callers get 401", async () => {
		const response = await app.request("/v1/auth/orgs/audit-logs", {
			method: "GET",
		});
		expect(response.status).toBe(401);
	});

	test("filters by event (single value)", async () => {
		const owner = requireOwnerData();
		const wantedId = await insertAuditLog({
			event: "session.cancelled",
			organizationId: owner.organizationId,
		});
		await insertAuditLog({
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?event=session.cancelled",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.data.length).toBe(1);
		expect(payload.data[0]?.id).toBe(wantedId);
		expect(payload.data[0]?.event).toBe("session.cancelled");
	});

	test("filters by multiple events (comma-separated)", async () => {
		const owner = requireOwnerData();
		const cancelledId = await insertAuditLog({
			event: "session.cancelled",
			organizationId: owner.organizationId,
		});
		const failedId = await insertAuditLog({
			event: "session.failed",
			organizationId: owner.organizationId,
		});
		await insertAuditLog({
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?event=session.cancelled,session.failed",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		const ids = payload.data.map((row) => row.id).sort();
		expect(ids).toEqual([cancelledId, failedId].sort());
	});

	test("event filter silently drops unknown names", async () => {
		const owner = requireOwnerData();
		const wantedId = await insertAuditLog({
			event: "session.cancelled",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?event=session.cancelled,not.an.event",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);

		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.data.map((row) => row.id)).toEqual([wantedId]);
	});

	test("filters by created_from", async () => {
		const owner = requireOwnerData();
		const oldId = await insertAuditLog({
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			event: "session.created",
			organizationId: owner.organizationId,
		});
		const recentId = await insertAuditLog({
			createdAt: new Date("2026-04-01T00:00:00.000Z"),
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?created_from=2026-03-01T00:00:00.000Z",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		const ids = payload.data.map((r) => r.id);
		expect(ids).toContain(recentId);
		expect(ids).not.toContain(oldId);
	});

	test("filters by created_to", async () => {
		const owner = requireOwnerData();
		const oldId = await insertAuditLog({
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			event: "session.created",
			organizationId: owner.organizationId,
		});
		const recentId = await insertAuditLog({
			createdAt: new Date("2026-04-01T00:00:00.000Z"),
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?created_to=2026-03-01T00:00:00.000Z",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		const ids = payload.data.map((r) => r.id);
		expect(ids).toContain(oldId);
		expect(ids).not.toContain(recentId);
	});

	test("filters by actor_user_id", async () => {
		const owner = requireOwnerData();
		const member = requireMemberData();
		const ownerRowId = await insertAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			event: "member.role.changed",
			organizationId: owner.organizationId,
		});
		const memberRowId = await insertAuditLog({
			actorType: "user",
			actorUserId: member.userId,
			event: "member.role.changed",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			`/v1/auth/orgs/audit-logs?actor_user_id=${owner.userId}`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		const ids = payload.data.map((r) => r.id);
		expect(ids).toContain(ownerRowId);
		expect(ids).not.toContain(memberRowId);
	});

	test("filters by actor_type=system", async () => {
		const owner = requireOwnerData();
		const userRowId = await insertAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			event: "member.role.changed",
			organizationId: owner.organizationId,
		});
		const systemRowId = await insertAuditLog({
			actorType: "system",
			event: "session.created",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			"/v1/auth/orgs/audit-logs?actor_type=system",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		const ids = payload.data.map((r) => r.id);
		expect(ids).toContain(systemRowId);
		expect(ids).not.toContain(userRowId);
	});

	test("free-text search hits event and target_id", async () => {
		const owner = requireOwnerData();
		const wantedEventId = await insertAuditLog({
			event: "webhook_endpoint.signing_secret.rotated",
			organizationId: owner.organizationId,
		});
		const wantedTargetId = await insertAuditLog({
			event: "session.created",
			organizationId: owner.organizationId,
			targetId: "vs_unique_target_abc123",
		});
		const unrelatedId = await insertAuditLog({
			event: "session.cancelled",
			organizationId: owner.organizationId,
			targetId: "vs_other",
		});

		const eventResponse = await app.request(
			"/v1/auth/orgs/audit-logs?q=signing_secret",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(eventResponse.status).toBe(200);
		const eventPayload = (await eventResponse.json()) as AuditLogsListResponse;
		const eventIds = eventPayload.data.map((r) => r.id);
		expect(eventIds).toContain(wantedEventId);
		expect(eventIds).not.toContain(unrelatedId);

		const targetResponse = await app.request(
			"/v1/auth/orgs/audit-logs?q=abc123",
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(targetResponse.status).toBe(200);
		const targetPayload =
			(await targetResponse.json()) as AuditLogsListResponse;
		const targetIds = targetPayload.data.map((r) => r.id);
		expect(targetIds).toContain(wantedTargetId);
		expect(targetIds).not.toContain(unrelatedId);
	});

	test("free-text search escapes ILIKE wildcards", async () => {
		const owner = requireOwnerData();
		// Plain "session" rows — no `%` in their event names.
		await insertAuditLog({
			event: "session.created",
			organizationId: owner.organizationId,
		});

		// A literal `%` shouldn't match anything because the search escapes it.
		const response = await app.request("/v1/auth/orgs/audit-logs?q=%25", {
			headers: jsonHeaders(owner.sessionCookie),
			method: "GET",
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.data.length).toBe(0);
	});

	test("combining filters narrows the result set", async () => {
		const owner = requireOwnerData();
		const wantedId = await insertAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			createdAt: new Date("2026-04-15T12:00:00.000Z"),
			event: "session.cancelled",
			organizationId: owner.organizationId,
		});
		// Same actor, different event.
		await insertAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			createdAt: new Date("2026-04-15T12:00:00.000Z"),
			event: "session.created",
			organizationId: owner.organizationId,
		});
		// Right event, but outside the date range.
		await insertAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			event: "session.cancelled",
			organizationId: owner.organizationId,
		});

		const response = await app.request(
			`/v1/auth/orgs/audit-logs?event=session.cancelled&actor_user_id=${owner.userId}&created_from=2026-04-01T00:00:00.000Z`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as AuditLogsListResponse;
		expect(payload.data.length).toBe(1);
		expect(payload.data[0]?.id).toBe(wantedId);
	});

	test("pagination does not drop rows tied on createdAt", async () => {
		const owner = requireOwnerData();
		// Insert four rows that share the same createdAt timestamp. The cursor
		// predicate has to use `(createdAt, id)` ordering — a naive
		// `lt(createdAt, x)` would skip everything tied with the cursor row.
		const tiedAt = new Date("2026-04-15T12:00:00.000Z");
		const ids: string[] = [];
		for (let index = 0; index < 4; index += 1) {
			ids.push(
				await insertAuditLog({
					createdAt: tiedAt,
					event: "session.created",
					organizationId: owner.organizationId,
				}),
			);
		}

		const firstPage = await app.request("/v1/auth/orgs/audit-logs?limit=2", {
			headers: jsonHeaders(owner.sessionCookie),
			method: "GET",
		});
		expect(firstPage.status).toBe(200);
		const firstPayload = (await firstPage.json()) as AuditLogsListResponse;
		expect(firstPayload.data.length).toBe(2);
		expect(firstPayload.pagination.has_more).toBe(true);
		const cursor = firstPayload.pagination.next_cursor;
		expect(typeof cursor).toBe("string");

		const secondPage = await app.request(
			`/v1/auth/orgs/audit-logs?limit=2&starting_after=${cursor}`,
			{
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			},
		);
		expect(secondPage.status).toBe(200);
		const secondPayload = (await secondPage.json()) as AuditLogsListResponse;

		const seen = new Set([
			...firstPayload.data.map((r) => r.id),
			...secondPayload.data.map((r) => r.id),
		]);
		// Every inserted row should appear on either page — no skipped ties.
		for (const id of ids) {
			expect(seen.has(id)).toBe(true);
		}
		// And no row should appear on both pages.
		expect(seen.size).toBe(
			firstPayload.data.length + secondPayload.data.length,
		);
	});
});

describe("Audit logs call-site emission", () => {
	test("recordAuditLog persists rows for its org", async () => {
		const owner = requireOwnerData();
		await recordAuditLog({
			actorType: "system",
			event: "api_key.created",
			metadata: { name: "test", permissions: ["sessions:read"] },
			organizationId: owner.organizationId,
			targetId: "target-1",
			targetType: "api_key",
		});

		const rows = await db
			.select()
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.event, "api_key.created"),
				),
			);
		expect(rows.length).toBe(1);
		expect(rows[0]?.targetId).toBe("target-1");
		expect((rows[0]?.metadata as Record<string, unknown>).name).toBe("test");
	});
});

describe("session.failed semantics", () => {
	test("non-terminal attempt records session.attempt.failed only", async () => {
		const owner = requireOwnerData();
		const sessionId = generateId({ type: "vs" });
		const attemptId = generateId({ type: "va" });

		await db.insert(verification_sessions).values({
			contractVersion: 1,
			expiresAt: new Date("2026-12-31T00:00:00.000Z"),
			id: sessionId,
			organizationId: owner.organizationId,
			shareFields: {},
			status: "in_progress",
		});
		await db.insert(verification_attempts).values({
			id: attemptId,
			status: "in_progress",
			verificationSessionId: sessionId,
		});

		const result = await markAttemptFailed({
			attemptId,
			failureCode: "selfie_face_mismatch",
			riskScore: 0.5,
			session: {
				completedAt: null,
				contractVersion: 1,
				id: sessionId,
				organizationId: owner.organizationId,
				status: "in_progress",
			},
		});
		expect(result.terminalized).toBe(false);

		const rows = await db
			.select({ event: audit_logs.event })
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.targetId, sessionId),
				),
			)
			.orderBy(asc(audit_logs.createdAt));
		const events = rows.map((r) => r.event);
		expect(events).toContain("session.attempt.failed");
		expect(events).not.toContain("session.failed");
	});

	test("retry-budget-exhausting attempt records both events", async () => {
		const owner = requireOwnerData();
		const sessionId = generateId({ type: "vs" });

		await db.insert(verification_sessions).values({
			contractVersion: 1,
			expiresAt: new Date("2026-12-31T00:00:00.000Z"),
			id: sessionId,
			organizationId: owner.organizationId,
			shareFields: {},
			status: "in_progress",
		});

		// Pre-seed two prior failed attempts so the third triggers terminalization.
		for (let index = 0; index < 2; index += 1) {
			await db.insert(verification_attempts).values({
				completedAt: new Date(),
				failureCode: "selfie_face_mismatch",
				id: generateId({ type: "va" }),
				riskScore: 0.5,
				status: "failed",
				verificationSessionId: sessionId,
			});
		}
		const finalAttemptId = generateId({ type: "va" });
		await db.insert(verification_attempts).values({
			id: finalAttemptId,
			status: "in_progress",
			verificationSessionId: sessionId,
		});

		const result = await markAttemptFailed({
			attemptId: finalAttemptId,
			failureCode: "selfie_face_mismatch",
			riskScore: 0.7,
			session: {
				completedAt: null,
				contractVersion: 1,
				id: sessionId,
				organizationId: owner.organizationId,
				status: "in_progress",
			},
		});
		expect(result.terminalized).toBe(true);

		const rows = await db
			.select({ event: audit_logs.event })
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.targetId, sessionId),
				),
			);
		const events = rows.map((r) => r.event);
		expect(events).toContain("session.attempt.failed");
		expect(events).toContain("session.failed");
	});
});

describe("Ownership-assigned event", () => {
	test("recordAuditLog accepts organization.ownership.assigned", async () => {
		// The ownership-assigned event is wired from better-auth's
		// `afterUpdateMemberRole` hook in `packages/auth/src/server.ts`.
		// End-to-end coverage of the hook requires the better-auth test client
		// path; here we assert the schema and helper accept the new event.
		const owner = requireOwnerData();
		await recordAuditLog({
			actorType: "user",
			actorUserId: owner.userId,
			event: "organization.ownership.assigned",
			metadata: { new_role: "owner", previous_role: "admin" },
			organizationId: owner.organizationId,
			targetId: "member-id",
			targetType: "member",
		});

		const [row] = await db
			.select()
			.from(audit_logs)
			.where(
				and(
					eq(audit_logs.organizationId, owner.organizationId),
					eq(audit_logs.event, "organization.ownership.assigned"),
				),
			)
			.orderBy(desc(audit_logs.createdAt))
			.limit(1);
		expect(row).toBeDefined();
		expect((row?.metadata as Record<string, unknown>).new_role).toBe("owner");
	});
});

describe("api_key actor type", () => {
	test("listing surfaces actor.type=api_key with the key name and id", async () => {
		const owner = requireOwnerData();
		const { id: apiKeyId } = await createApiKey({
			name: "Deploy bot",
			organizationId: owner.organizationId,
			permissions: ["webhooks:write"],
		});

		try {
			await recordAuditLog({
				actorApiKeyId: apiKeyId,
				actorType: "api_key",
				event: "webhook_endpoint.created",
				organizationId: owner.organizationId,
				targetId: "whe_test_target",
				targetType: "webhook_endpoint",
			});

			const response = await app.request("/v1/auth/orgs/audit-logs", {
				headers: jsonHeaders(owner.sessionCookie),
				method: "GET",
			});
			expect(response.status).toBe(200);
			const payload = (await response.json()) as AuditLogsListResponse;
			const apiKeyRow = payload.data.find(
				(row) => row.actor.type === "api_key",
			);
			expect(apiKeyRow).toBeDefined();
			expect(apiKeyRow?.actor.apiKeyId).toBe(apiKeyId);
			expect(apiKeyRow?.actor.apiKeyName).toBe("Deploy bot");
			expect(apiKeyRow?.actor.name).toBe("Deploy bot");
			expect(apiKeyRow?.actor.id).toBe(apiKeyId);
		} finally {
			await db.delete(api_keys).where(eq(api_keys.id, apiKeyId));
		}
	});

	test("filters by actor_type=api_key", async () => {
		const owner = requireOwnerData();
		const { id: apiKeyId } = await createApiKey({
			name: "Filter probe",
			organizationId: owner.organizationId,
			permissions: ["webhooks:write"],
		});

		try {
			const apiKeyRowId = await insertAuditLog({
				actorApiKeyId: apiKeyId,
				actorType: "api_key",
				event: "webhook_endpoint.created",
				organizationId: owner.organizationId,
			});
			const userRowId = await insertAuditLog({
				actorType: "user",
				actorUserId: owner.userId,
				event: "webhook_endpoint.updated",
				organizationId: owner.organizationId,
			});
			const systemRowId = await insertAuditLog({
				event: "session.created",
				organizationId: owner.organizationId,
			});

			const response = await app.request(
				"/v1/auth/orgs/audit-logs?actor_type=api_key",
				{
					headers: jsonHeaders(owner.sessionCookie),
					method: "GET",
				},
			);
			expect(response.status).toBe(200);
			const payload = (await response.json()) as AuditLogsListResponse;
			const ids = payload.data.map((r) => r.id);
			expect(ids).toContain(apiKeyRowId);
			expect(ids).not.toContain(userRowId);
			expect(ids).not.toContain(systemRowId);
		} finally {
			await db.delete(api_keys).where(eq(api_keys.id, apiKeyId));
		}
	});

	test("filters by actor_api_key_id", async () => {
		const owner = requireOwnerData();
		const { id: keyA } = await createApiKey({
			name: "Key A",
			organizationId: owner.organizationId,
			permissions: ["webhooks:write"],
		});
		const { id: keyB } = await createApiKey({
			name: "Key B",
			organizationId: owner.organizationId,
			permissions: ["webhooks:write"],
		});

		try {
			const keyARowId = await insertAuditLog({
				actorApiKeyId: keyA,
				actorType: "api_key",
				event: "webhook_endpoint.created",
				organizationId: owner.organizationId,
			});
			const keyBRowId = await insertAuditLog({
				actorApiKeyId: keyB,
				actorType: "api_key",
				event: "webhook_endpoint.created",
				organizationId: owner.organizationId,
			});

			const response = await app.request(
				`/v1/auth/orgs/audit-logs?actor_api_key_id=${keyA}`,
				{
					headers: jsonHeaders(owner.sessionCookie),
					method: "GET",
				},
			);
			expect(response.status).toBe(200);
			const payload = (await response.json()) as AuditLogsListResponse;
			const ids = payload.data.map((r) => r.id);
			expect(ids).toContain(keyARowId);
			expect(ids).not.toContain(keyBRowId);
		} finally {
			await db.delete(api_keys).where(eq(api_keys.id, keyA));
			await db.delete(api_keys).where(eq(api_keys.id, keyB));
		}
	});

	test("free-text search matches the joined api_key name", async () => {
		const owner = requireOwnerData();
		const { id: apiKeyId } = await createApiKey({
			name: "ScrapeRunnerAlpha",
			organizationId: owner.organizationId,
			permissions: ["webhooks:write"],
		});

		try {
			const wantedId = await insertAuditLog({
				actorApiKeyId: apiKeyId,
				actorType: "api_key",
				event: "webhook_endpoint.created",
				organizationId: owner.organizationId,
			});
			await insertAuditLog({
				event: "session.created",
				organizationId: owner.organizationId,
			});

			const response = await app.request(
				"/v1/auth/orgs/audit-logs?q=ScrapeRunner",
				{
					headers: jsonHeaders(owner.sessionCookie),
					method: "GET",
				},
			);
			expect(response.status).toBe(200);
			const payload = (await response.json()) as AuditLogsListResponse;
			const ids = payload.data.map((r) => r.id);
			expect(ids).toContain(wantedId);
		} finally {
			await db.delete(api_keys).where(eq(api_keys.id, apiKeyId));
		}
	});
});
