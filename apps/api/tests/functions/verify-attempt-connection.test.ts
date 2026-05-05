import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@kayle-id/database/drizzle";
import {
	verification_attempts,
	verification_sessions,
} from "@kayle-id/database/schema/core";
import { eq } from "drizzle-orm";
import {
	ATTEMPT_CONNECTION_ACTIVE_CODE,
	ATTEMPT_STALE_CLAIM_MS,
	claimAttemptConnection,
	releaseAttemptConnection,
} from "@/v1/verify/attempt-connection";
import { setup, type TestData, teardown } from "../setup";

let TEST_DATA: TestData | undefined;
const createdSessionIds: string[] = [];
const createdAttemptIds: string[] = [];

async function createSessionAndAttempt(): Promise<{
	sessionId: string;
	attemptId: string;
}> {
	const organizationId = TEST_DATA?.organizationId as string;
	const sessionId = `vs_${crypto.randomUUID()}`;
	const attemptId = `va_${crypto.randomUUID()}`;

	await db.insert(verification_sessions).values({
		id: sessionId,
		organizationId,
	});
	await db.insert(verification_attempts).values({
		id: attemptId,
		verificationSessionId: sessionId,
	});

	createdSessionIds.push(sessionId);
	createdAttemptIds.push(attemptId);
	return { sessionId, attemptId };
}

beforeAll(async () => {
	TEST_DATA = await setup();
});

afterEach(async () => {
	for (const attemptId of createdAttemptIds) {
		await db
			.delete(verification_attempts)
			.where(eq(verification_attempts.id, attemptId));
	}
	createdAttemptIds.length = 0;

	for (const sessionId of createdSessionIds) {
		await db
			.delete(verification_sessions)
			.where(eq(verification_sessions.id, sessionId));
	}
	createdSessionIds.length = 0;
});

afterAll(async () => {
	await teardown(TEST_DATA);
	TEST_DATA = undefined;
});

describe("attempt-connection durable claim", () => {
	test("first claim succeeds and persists owner + claimedAt", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const ownerId = crypto.randomUUID();

		const result = await claimAttemptConnection({ attemptId, ownerId });

		expect(result.ok).toBeTrue();

		const [row] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
				claimedAt: verification_attempts.claimedAt,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);

		expect(row?.claimedBy).toBe(ownerId);
		expect(row?.claimedAt).not.toBeNull();
	});

	test("a second connection cannot claim a live attempt held by another owner", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const owner1 = crypto.randomUUID();
		const owner2 = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId: owner1 });
		const second = await claimAttemptConnection({
			attemptId,
			ownerId: owner2,
		});

		expect(second.ok).toBeFalse();
		if (!second.ok) {
			expect(second.code).toBe(ATTEMPT_CONNECTION_ACTIVE_CODE);
		}
	});

	test("the original owner can re-claim its own attempt", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const ownerId = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId });
		const second = await claimAttemptConnection({ attemptId, ownerId });

		expect(second.ok).toBeTrue();
	});

	test("a stale claim (older than STALE_CLAIM_MS) is recoverable", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const oldOwner = crypto.randomUUID();
		const newOwner = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId: oldOwner });

		// Backdate the claim past the stale threshold so the next claim wins.
		const staleAt = new Date(Date.now() - (ATTEMPT_STALE_CLAIM_MS + 60_000));
		await db
			.update(verification_attempts)
			.set({ claimedAt: staleAt })
			.where(eq(verification_attempts.id, attemptId));

		const recovered = await claimAttemptConnection({
			attemptId,
			ownerId: newOwner,
		});

		expect(recovered.ok).toBeTrue();

		const [row] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);

		expect(row?.claimedBy).toBe(newOwner);
	});

	test("allowTakeover lets a new owner displace a live claim", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const oldOwner = crypto.randomUUID();
		const newOwner = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId: oldOwner });

		const takenOver = await claimAttemptConnection({
			attemptId,
			ownerId: newOwner,
			allowTakeover: true,
		});

		expect(takenOver.ok).toBeTrue();

		const [row] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);

		expect(row?.claimedBy).toBe(newOwner);
	});

	test("a stale release from the prior owner is a no-op after takeover", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const oldOwner = crypto.randomUUID();
		const newOwner = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId: oldOwner });
		await claimAttemptConnection({
			attemptId,
			ownerId: newOwner,
			allowTakeover: true,
		});

		// The previous socket's close handler eventually fires release with
		// its own ownerId. It must not clear the new owner's claim.
		await releaseAttemptConnection({ attemptId, ownerId: oldOwner });

		const [row] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);

		expect(row?.claimedBy).toBe(newOwner);
	});

	test("release clears the claim only when the owner matches", async () => {
		const { attemptId } = await createSessionAndAttempt();
		const owner1 = crypto.randomUUID();
		const owner2 = crypto.randomUUID();

		await claimAttemptConnection({ attemptId, ownerId: owner1 });

		// A foreign release must be a no-op.
		await releaseAttemptConnection({ attemptId, ownerId: owner2 });

		const [stillHeld] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);
		expect(stillHeld?.claimedBy).toBe(owner1);

		await releaseAttemptConnection({ attemptId, ownerId: owner1 });

		const [released] = await db
			.select({
				claimedBy: verification_attempts.claimedByConnectionId,
				claimedAt: verification_attempts.claimedAt,
			})
			.from(verification_attempts)
			.where(eq(verification_attempts.id, attemptId))
			.limit(1);
		expect(released?.claimedBy).toBeNull();
		expect(released?.claimedAt).toBeNull();
	});
});
