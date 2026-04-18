import { db } from "@kayle-id/database/drizzle";
import {
  verification_attempts,
  verification_sessions,
} from "@kayle-id/database/schema/core";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { expireVerificationSessionIfNeeded } from "@/v1/sessions/repo/session-repo";
import { isTerminalAttemptStatus, isTerminalSessionStatus } from "./status";

export type PublicVerifyAttemptStatus = {
  completed_at: string | null;
  failure_code: string | null;
  handoff_claimed: boolean;
  id: string;
  retry_allowed: boolean;
  status: "cancelled" | "failed" | "in_progress" | "succeeded";
};

export type PublicVerifySessionStatus = {
  completed_at: string | null;
  is_terminal: boolean;
  latest_attempt: PublicVerifyAttemptStatus | null;
  redirect_url: string | null;
  session_id: string;
  same_device_only: boolean;
  status: "cancelled" | "completed" | "created" | "expired" | "in_progress";
};

export async function getPublicVerifySessionStatus({
  now = new Date(),
  sessionId,
}: {
  now?: Date;
  sessionId: string;
}): Promise<PublicVerifySessionStatus | null> {
  const [rawSession] = await db
    .select()
    .from(verification_sessions)
    .where(
      and(
        eq(verification_sessions.id, sessionId),
        eq(verification_sessions.environment, "live")
      )
    )
    .limit(1);

  if (!rawSession) {
    return null;
  }

  const session = await expireVerificationSessionIfNeeded({
    now,
    row: rawSession,
  });

  const [attempt] = await db
    .select({
      completedAt: verification_attempts.completedAt,
      failureCode: verification_attempts.failureCode,
      id: verification_attempts.id,
      mobileHelloDeviceIdHash: verification_attempts.mobileHelloDeviceIdHash,
      mobileWriteTokenConsumedAt:
        verification_attempts.mobileWriteTokenConsumedAt,
      status: verification_attempts.status,
    })
    .from(verification_attempts)
    .where(eq(verification_attempts.verificationSessionId, session.id))
    .orderBy(desc(verification_attempts.createdAt))
    .limit(1);

  const [claimedAttempt] = await db
    .select({
      id: verification_attempts.id,
    })
    .from(verification_attempts)
    .where(
      and(
        eq(verification_attempts.verificationSessionId, session.id),
        or(
          isNotNull(verification_attempts.mobileWriteTokenConsumedAt),
          isNotNull(verification_attempts.mobileHelloDeviceIdHash)
        )
      )
    )
    .limit(1);

  const latestAttempt =
    attempt &&
    (attempt.status === "in_progress" ||
      isTerminalAttemptStatus(attempt.status))
      ? {
          completed_at: attempt.completedAt?.toISOString() ?? null,
          failure_code: attempt.failureCode ?? null,
          handoff_claimed: Boolean(
            attempt.mobileWriteTokenConsumedAt || attempt.mobileHelloDeviceIdHash
          ),
          id: attempt.id,
          retry_allowed:
            attempt.status === "failed" &&
            !isTerminalSessionStatus(session.status),
          status: attempt.status,
        }
      : null;

  return {
    completed_at: session.completedAt?.toISOString() ?? null,
    is_terminal: isTerminalSessionStatus(session.status),
    latest_attempt: latestAttempt,
    redirect_url: session.redirectUrl ?? null,
    session_id: session.id,
    same_device_only: Boolean(claimedAttempt),
    status: session.status,
  };
}
