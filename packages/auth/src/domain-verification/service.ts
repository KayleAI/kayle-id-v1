import { db } from "@kayle-id/database/drizzle";
import {
  auth_organization_domain_challenges,
  auth_organization_members,
  auth_organization_redirect_uris,
  auth_organization_verified_domains,
  auth_organizations,
  auth_users,
  type OrganizationDomainVerificationMethod,
} from "@kayle-id/database/schema/auth";
import { and, desc, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { hasOrgRole } from "../permissions";
import { ApexExtractionError, hostnameToApex } from "./apex";
import { type DohFetch, lookupTxt } from "./doh";
import {
  dnsRecordNameForApex,
  formatDnsRecordValue,
  generateDnsChallengeToken,
} from "./tokens";

const DNS_CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type DomainVerificationErrorCode =
  | "APEX_INVALID"
  | "APEX_TAKEOVER_REQUIRED"
  | "CHALLENGE_EXPIRED"
  | "CHALLENGE_NOT_FOUND"
  | "DNS_NOT_PROPAGATED"
  | "DNS_LOOKUP_FAILED"
  | "DOMAIN_NOT_FOUND"
  | "FORBIDDEN"
  | "ORGANIZATION_NOT_FOUND";

interface DomainVerificationErrorDetails {
  conflictingOrganizationName?: string;
}

export class DomainVerificationError extends Error {
  code: DomainVerificationErrorCode;
  status: number;
  details: DomainVerificationErrorDetails;
  constructor(
    code: DomainVerificationErrorCode,
    message: string,
    status: number,
    details: DomainVerificationErrorDetails = {}
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = "DomainVerificationError";
  }
}

/**
 * Look up the org currently holding an *active* verified-domain row for
 * `apexDomain`, excluding `excludingOrganizationId`. Used to detect cross-org
 * conflicts before issuing a challenge and to drive the takeover handshake
 * when verifying.
 */
async function findConflictingActiveOwner({
  apexDomain,
  excludingOrganizationId,
}: {
  apexDomain: string;
  excludingOrganizationId: string;
}): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({
      id: auth_organizations.id,
      name: auth_organizations.name,
    })
    .from(auth_organization_verified_domains)
    .innerJoin(
      auth_organizations,
      eq(
        auth_organizations.id,
        auth_organization_verified_domains.organizationId
      )
    )
    .where(
      and(
        eq(auth_organization_verified_domains.apexDomain, apexDomain),
        isNull(auth_organization_verified_domains.downgradedAt),
        ne(
          auth_organization_verified_domains.organizationId,
          excludingOrganizationId
        )
      )
    )
    .limit(1);
  return row ?? null;
}

interface ActorContext {
  organizationId: string;
  userId: string;
}

async function assertOwner({
  organizationId,
  userId,
}: ActorContext): Promise<void> {
  const [member] = await db
    .select({ role: auth_organization_members.role })
    .from(auth_organization_members)
    .where(
      and(
        eq(auth_organization_members.organizationId, organizationId),
        eq(auth_organization_members.userId, userId)
      )
    )
    .limit(1);

  if (!(member && hasOrgRole(member.role, "owner"))) {
    throw new DomainVerificationError(
      "FORBIDDEN",
      "Only an owner can manage verified domains.",
      403
    );
  }
}

function normalizeApexOrThrow(rawApex: string): string {
  try {
    return hostnameToApex(rawApex);
  } catch (error) {
    if (error instanceof ApexExtractionError) {
      throw new DomainVerificationError("APEX_INVALID", error.message, 400);
    }
    throw error;
  }
}

// Apex ownership is per-org with a global-unique-active invariant. The
// `auth_org_verified_domains_active_apex_uidx` partial index guarantees that
// at most one org has an active row for a given apex at any time. When a
// second org tries to verify the same apex, the verify step performs an
// explicit takeover: we surface a `conflict` field at start-challenge time
// so the wizard can ask the user to acknowledge, then the verify call
// downgrades the previous owner's row in the same transaction it inserts
// the new one.

export interface StartDnsChallengeResult {
  challengeId: string;
  conflict: { organizationName: string } | null;
  expiresAt: Date;
  recordName: string;
  recordValue: string;
}

export async function startDnsChallenge({
  organizationId,
  userId,
  rawApex,
  now = new Date(),
}: ActorContext & {
  rawApex: string;
  now?: Date;
}): Promise<StartDnsChallengeResult> {
  await assertOwner({ organizationId, userId });
  const apexDomain = normalizeApexOrThrow(rawApex);

  const token = generateDnsChallengeToken();
  const expiresAt = new Date(now.getTime() + DNS_CHALLENGE_TTL_MS);

  const conflictingOwner = await findConflictingActiveOwner({
    apexDomain,
    excludingOrganizationId: organizationId,
  });

  const challengeId = await db.transaction(async (tx) => {
    await tx
      .delete(auth_organization_domain_challenges)
      .where(
        and(
          eq(
            auth_organization_domain_challenges.organizationId,
            organizationId
          ),
          eq(auth_organization_domain_challenges.apexDomain, apexDomain),
          eq(auth_organization_domain_challenges.method, "dns_txt")
        )
      );

    const [inserted] = await tx
      .insert(auth_organization_domain_challenges)
      .values({
        organizationId,
        apexDomain,
        method: "dns_txt",
        token,
        expiresAt,
        createdBy: userId,
      })
      .returning({ id: auth_organization_domain_challenges.id });

    return inserted.id;
  });

  return {
    challengeId,
    conflict: conflictingOwner
      ? { organizationName: conflictingOwner.name }
      : null,
    recordName: dnsRecordNameForApex(apexDomain),
    recordValue: formatDnsRecordValue(token),
    expiresAt,
  };
}

export interface VerifyDnsChallengeResult {
  apexDomain: string;
  domainId: string;
  takeoverFrom: { organizationId: string; organizationName: string } | null;
}

export async function verifyDnsChallenge({
  organizationId,
  userId,
  challengeId,
  acknowledgeTakeover = false,
  now = new Date(),
  fetchImpl,
}: ActorContext & {
  challengeId: string;
  acknowledgeTakeover?: boolean;
  now?: Date;
  fetchImpl?: DohFetch;
}): Promise<VerifyDnsChallengeResult> {
  await assertOwner({ organizationId, userId });

  const [challenge] = await db
    .select()
    .from(auth_organization_domain_challenges)
    .where(
      and(
        eq(auth_organization_domain_challenges.id, challengeId),
        eq(auth_organization_domain_challenges.organizationId, organizationId),
        eq(auth_organization_domain_challenges.method, "dns_txt")
      )
    )
    .limit(1);

  if (!challenge) {
    throw new DomainVerificationError(
      "CHALLENGE_NOT_FOUND",
      "Challenge not found. Start a new DNS challenge.",
      404
    );
  }
  if (challenge.expiresAt.getTime() < now.getTime()) {
    throw new DomainVerificationError(
      "CHALLENGE_EXPIRED",
      "Challenge has expired. Start a new DNS challenge.",
      400
    );
  }

  // Detect a cross-org conflict before doing the DNS lookup so we never
  // perform a destructive takeover under a transient missing-record
  // scenario. The DB also enforces global uniqueness via a partial unique
  // index, but doing the check explicitly lets us surface a structured
  // error instead of letting Postgres throw a generic 23505 to the caller.
  const conflictingOwner = await findConflictingActiveOwner({
    apexDomain: challenge.apexDomain,
    excludingOrganizationId: organizationId,
  });
  if (conflictingOwner && !acknowledgeTakeover) {
    throw new DomainVerificationError(
      "APEX_TAKEOVER_REQUIRED",
      `${conflictingOwner.name} currently has an active verification for this domain. Acknowledge the takeover to continue.`,
      409,
      { conflictingOrganizationName: conflictingOwner.name }
    );
  }

  const expectedValue = formatDnsRecordValue(challenge.token);
  const recordName = dnsRecordNameForApex(challenge.apexDomain);
  const lookup = await lookupTxt({ recordName, fetchImpl });

  if (!lookup.ok) {
    if (lookup.reason === "no_record") {
      throw new DomainVerificationError(
        "DNS_NOT_PROPAGATED",
        "We couldn't find the verification TXT record yet. DNS may take a few minutes to propagate.",
        409
      );
    }
    throw new DomainVerificationError(
      "DNS_LOOKUP_FAILED",
      "DNS lookup failed. Please try again in a moment.",
      503
    );
  }

  if (!lookup.values.some((value) => value === expectedValue)) {
    throw new DomainVerificationError(
      "DNS_NOT_PROPAGATED",
      "Verification TXT record value does not match. Check the record and try again.",
      409
    );
  }

  const domainId = await db.transaction(async (tx) => {
    if (conflictingOwner) {
      // Downgrade the previous owner's active row in the same transaction
      // we insert ours, so the partial-unique index never sees two active
      // rows for the same apex.
      await tx
        .update(auth_organization_verified_domains)
        .set({ downgradedAt: now, updatedAt: now })
        .where(
          and(
            eq(
              auth_organization_verified_domains.organizationId,
              conflictingOwner.id
            ),
            eq(
              auth_organization_verified_domains.apexDomain,
              challenge.apexDomain
            ),
            isNull(auth_organization_verified_domains.downgradedAt)
          )
        );
    }

    const [inserted] = await tx
      .insert(auth_organization_verified_domains)
      .values({
        organizationId,
        apexDomain: challenge.apexDomain,
        verifiedAt: now,
        verifiedVia: "dns_txt",
        verifiedBy: userId,
        recheckToken: challenge.token,
        lastCheckedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          auth_organization_verified_domains.organizationId,
          auth_organization_verified_domains.apexDomain,
        ],
        set: {
          verifiedAt: now,
          verifiedVia: "dns_txt",
          verifiedBy: userId,
          recheckToken: challenge.token,
          lastCheckedAt: now,
          consecutiveFailedChecks: 0,
          downgradedAt: null,
          updatedAt: now,
        },
      })
      .returning({ id: auth_organization_verified_domains.id });

    await tx
      .delete(auth_organization_domain_challenges)
      .where(eq(auth_organization_domain_challenges.id, challenge.id));

    return inserted.id;
  });

  return {
    apexDomain: challenge.apexDomain,
    domainId,
    takeoverFrom: conflictingOwner
      ? {
          organizationId: conflictingOwner.id,
          organizationName: conflictingOwner.name,
        }
      : null,
  };
}

export interface ListedVerifiedDomain {
  apexDomain: string;
  downgradedAt: Date | null;
  id: string;
  lastCheckedAt: Date | null;
  verifiedAt: Date;
  verifiedVia: OrganizationDomainVerificationMethod;
}

export interface ListedActiveChallenge {
  apexDomain: string;
  createdAt: Date;
  expiresAt: Date;
  id: string;
  method: OrganizationDomainVerificationMethod;
}

export async function listOrganizationDomains({
  organizationId,
  now = new Date(),
}: {
  organizationId: string;
  now?: Date;
}): Promise<{
  domains: ListedVerifiedDomain[];
  challenges: ListedActiveChallenge[];
}> {
  const [domains, challenges] = await Promise.all([
    db
      .select({
        id: auth_organization_verified_domains.id,
        apexDomain: auth_organization_verified_domains.apexDomain,
        verifiedAt: auth_organization_verified_domains.verifiedAt,
        verifiedVia: auth_organization_verified_domains.verifiedVia,
        lastCheckedAt: auth_organization_verified_domains.lastCheckedAt,
        downgradedAt: auth_organization_verified_domains.downgradedAt,
      })
      .from(auth_organization_verified_domains)
      .where(
        eq(auth_organization_verified_domains.organizationId, organizationId)
      )
      .orderBy(desc(auth_organization_verified_domains.verifiedAt)),
    db
      .select({
        id: auth_organization_domain_challenges.id,
        apexDomain: auth_organization_domain_challenges.apexDomain,
        method: auth_organization_domain_challenges.method,
        expiresAt: auth_organization_domain_challenges.expiresAt,
        createdAt: auth_organization_domain_challenges.createdAt,
      })
      .from(auth_organization_domain_challenges)
      .where(
        and(
          eq(
            auth_organization_domain_challenges.organizationId,
            organizationId
          ),
          gt(auth_organization_domain_challenges.expiresAt, now)
        )
      )
      .orderBy(desc(auth_organization_domain_challenges.createdAt)),
  ]);

  return { domains, challenges };
}

export async function removeVerifiedDomain({
  organizationId,
  userId,
  domainId,
}: ActorContext & { domainId: string }): Promise<void> {
  await assertOwner({ organizationId, userId });

  const [deleted] = await db
    .delete(auth_organization_verified_domains)
    .where(
      and(
        eq(auth_organization_verified_domains.id, domainId),
        eq(auth_organization_verified_domains.organizationId, organizationId)
      )
    )
    .returning({ id: auth_organization_verified_domains.id });

  if (!deleted) {
    throw new DomainVerificationError(
      "DOMAIN_NOT_FOUND",
      "Verified domain not found.",
      404
    );
  }
}

export interface ListedRedirectUri {
  apexDomain: string;
  createdAt: Date;
  id: string;
  pattern: string;
  verifiedDomainId: string;
}

export async function listRedirectUris({
  organizationId,
}: {
  organizationId: string;
}): Promise<ListedRedirectUri[]> {
  return await db
    .select({
      id: auth_organization_redirect_uris.id,
      pattern: auth_organization_redirect_uris.pattern,
      verifiedDomainId: auth_organization_redirect_uris.verifiedDomainId,
      apexDomain: auth_organization_verified_domains.apexDomain,
      createdAt: auth_organization_redirect_uris.createdAt,
    })
    .from(auth_organization_redirect_uris)
    .innerJoin(
      auth_organization_verified_domains,
      eq(
        auth_organization_verified_domains.id,
        auth_organization_redirect_uris.verifiedDomainId
      )
    )
    .where(eq(auth_organization_redirect_uris.organizationId, organizationId))
    .orderBy(desc(auth_organization_redirect_uris.createdAt));
}

export async function addRedirectUri({
  organizationId,
  userId,
  pattern,
  matchingApexDomain,
}: ActorContext & {
  pattern: string;
  matchingApexDomain: string;
}): Promise<{ id: string; verifiedDomainId: string }> {
  await assertOwner({ organizationId, userId });

  const [domain] = await db
    .select({ id: auth_organization_verified_domains.id })
    .from(auth_organization_verified_domains)
    .where(
      and(
        eq(auth_organization_verified_domains.organizationId, organizationId),
        eq(auth_organization_verified_domains.apexDomain, matchingApexDomain),
        isNull(auth_organization_verified_domains.downgradedAt)
      )
    )
    .limit(1);

  if (!domain) {
    throw new DomainVerificationError(
      "DOMAIN_NOT_FOUND",
      "Pattern host does not match any of your verified domains.",
      422
    );
  }

  const [inserted] = await db
    .insert(auth_organization_redirect_uris)
    .values({
      organizationId,
      verifiedDomainId: domain.id,
      pattern,
      createdBy: userId,
    })
    .onConflictDoNothing({
      target: [
        auth_organization_redirect_uris.verifiedDomainId,
        auth_organization_redirect_uris.pattern,
      ],
    })
    .returning({ id: auth_organization_redirect_uris.id });

  if (!inserted) {
    const [existing] = await db
      .select({ id: auth_organization_redirect_uris.id })
      .from(auth_organization_redirect_uris)
      .where(
        and(
          eq(auth_organization_redirect_uris.verifiedDomainId, domain.id),
          eq(auth_organization_redirect_uris.pattern, pattern)
        )
      )
      .limit(1);
    if (!existing) {
      throw new DomainVerificationError(
        "DOMAIN_NOT_FOUND",
        "Failed to register redirect URI.",
        500
      );
    }
    return { id: existing.id, verifiedDomainId: domain.id };
  }

  return { id: inserted.id, verifiedDomainId: domain.id };
}

export async function removeRedirectUri({
  organizationId,
  userId,
  redirectUriId,
}: ActorContext & { redirectUriId: string }): Promise<void> {
  await assertOwner({ organizationId, userId });

  const [deleted] = await db
    .delete(auth_organization_redirect_uris)
    .where(
      and(
        eq(auth_organization_redirect_uris.id, redirectUriId),
        eq(auth_organization_redirect_uris.organizationId, organizationId)
      )
    )
    .returning({ id: auth_organization_redirect_uris.id });

  if (!deleted) {
    throw new DomainVerificationError(
      "DOMAIN_NOT_FOUND",
      "Redirect URI not found.",
      404
    );
  }
}

/**
 * Helper for the cron and the read-only "is this redirect still permitted?"
 * endpoint. Returns the active verified-domain rows for an org.
 */
export async function listActiveVerifiedDomainsForOrg(
  organizationId: string
): Promise<{ apexDomain: string; verifiedDomainId: string }[]> {
  return await db
    .select({
      verifiedDomainId: auth_organization_verified_domains.id,
      apexDomain: auth_organization_verified_domains.apexDomain,
    })
    .from(auth_organization_verified_domains)
    .where(
      and(
        eq(auth_organization_verified_domains.organizationId, organizationId),
        isNull(auth_organization_verified_domains.downgradedAt)
      )
    );
}

export async function getActiveApexForOrg(
  organizationId: string
): Promise<string | null> {
  const [row] = await db
    .select({ apexDomain: auth_organization_verified_domains.apexDomain })
    .from(auth_organization_verified_domains)
    .where(
      and(
        eq(auth_organization_verified_domains.organizationId, organizationId),
        isNull(auth_organization_verified_domains.downgradedAt)
      )
    )
    .orderBy(desc(auth_organization_verified_domains.verifiedAt))
    .limit(1);
  return row?.apexDomain ?? null;
}

/**
 * Returns true if `organizationId` has at least one verified-domain row whose
 * apex covers `host` (host equals the apex or is a subdomain). When
 * per-domain narrowing is configured (`auth_organization_redirect_uris`
 * rows exist for that verified domain), the URL must additionally match a
 * registered pattern via path-prefix.
 */
export async function isUrlPermittedForOrg({
  organizationId,
  host,
  fullUrl,
}: {
  organizationId: string;
  host: string;
  fullUrl: string;
}): Promise<{ ok: boolean; matchedDomainId?: string; reason?: string }> {
  const verified = await listActiveVerifiedDomainsForOrg(organizationId);
  for (const row of verified) {
    if (host === row.apexDomain || host.endsWith(`.${row.apexDomain}`)) {
      const patterns = await db
        .select({ pattern: auth_organization_redirect_uris.pattern })
        .from(auth_organization_redirect_uris)
        .where(
          eq(
            auth_organization_redirect_uris.verifiedDomainId,
            row.verifiedDomainId
          )
        );

      if (patterns.length === 0) {
        return { ok: true, matchedDomainId: row.verifiedDomainId };
      }

      const matched = patterns.some((p) => fullUrl.startsWith(p.pattern));
      if (matched) {
        return { ok: true, matchedDomainId: row.verifiedDomainId };
      }
      return { ok: false, reason: "pattern_mismatch" };
    }
  }
  return { ok: false, reason: "domain_unverified" };
}

/**
 * Cron entry: re-verify DNS-method rows that are due. Soft-fails on infra
 * errors (no counter increment). Increments `consecutive_failed_checks` on
 * a clean DNS miss; once it reaches the threshold the row is downgraded and
 * owners receive a notification email (handled by the caller via the
 * returned `downgraded` array since email send needs Worker bindings).
 *
 * Scaling notes:
 * - The cron predicate (`shouldRunDomainReverification`) fires this body
 *   every 5 minutes, so the per-run budget needs to fit comfortably in a
 *   Cloudflare Worker scheduled-handler invocation.
 * - Lookups run in parallel chunks of `concurrency` rows so wall time
 *   scales by `ceil(batchSize / concurrency) * lookupRtt` rather than
 *   `batchSize * lookupRtt`. With the defaults (batchSize=500,
 *   concurrency=25) a fully-loaded run hits 20 chunks ≈ ~4s wall time.
 * - At 10k verified domains, ~10000/24/12 ≈ 35 rows are due per run on
 *   average — well under the cap. Bursts (e.g. a large backlog after the
 *   cron was paused) drain in a few runs because the cap is generous.
 */
export interface DomainRecheckStats {
  checked: number;
  downgraded: {
    domainId: string;
    organizationId: string;
    apexDomain: string;
  }[];
  errored: number;
  missed: number;
  ok: number;
}

interface DueRow {
  apexDomain: string;
  consecutiveFailedChecks: number;
  id: string;
  organizationId: string;
  recheckToken: string | null;
}

type RowOutcome =
  | { kind: "ok" }
  | { kind: "miss" }
  | { kind: "downgraded" }
  | { kind: "errored" };

async function processDueRow({
  row,
  now,
  downgradeAfterFailures,
  fetchImpl,
}: {
  row: DueRow;
  now: Date;
  downgradeAfterFailures: number;
  fetchImpl?: DohFetch;
}): Promise<{
  outcome: RowOutcome;
  downgraded?: {
    domainId: string;
    organizationId: string;
    apexDomain: string;
  };
}> {
  if (!row.recheckToken) {
    // Defensive: a DNS-method row without a recheck token can't be
    // re-validated. Skip silently — would only happen if a future migration
    // backfills rows.
    return { outcome: { kind: "errored" } };
  }

  const expectedValue = formatDnsRecordValue(row.recheckToken);
  const recordName = dnsRecordNameForApex(row.apexDomain);
  const lookup = await lookupTxt({ recordName, fetchImpl });

  if (!lookup.ok && lookup.reason !== "no_record") {
    // Soft fail: don't increment, don't update lastCheckedAt either — we
    // want to retry on the next tick.
    return { outcome: { kind: "errored" } };
  }

  const hit =
    lookup.ok && lookup.values.some((value) => value === expectedValue);

  if (hit) {
    await db
      .update(auth_organization_verified_domains)
      .set({
        consecutiveFailedChecks: 0,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(auth_organization_verified_domains.id, row.id));
    return { outcome: { kind: "ok" } };
  }

  const nextFailures = row.consecutiveFailedChecks + 1;
  if (nextFailures >= downgradeAfterFailures) {
    await db
      .update(auth_organization_verified_domains)
      .set({
        consecutiveFailedChecks: nextFailures,
        lastCheckedAt: now,
        downgradedAt: now,
        updatedAt: now,
      })
      .where(eq(auth_organization_verified_domains.id, row.id));
    return {
      outcome: { kind: "downgraded" },
      downgraded: {
        domainId: row.id,
        organizationId: row.organizationId,
        apexDomain: row.apexDomain,
      },
    };
  }

  await db
    .update(auth_organization_verified_domains)
    .set({
      consecutiveFailedChecks: nextFailures,
      lastCheckedAt: now,
      updatedAt: now,
    })
    .where(eq(auth_organization_verified_domains.id, row.id));
  return { outcome: { kind: "miss" } };
}

export async function runDomainReverification({
  now = new Date(),
  batchSize = 500,
  concurrency = 25,
  staleAfterMs = 23 * 60 * 60 * 1000,
  downgradeAfterFailures = 3,
  fetchImpl,
}: {
  now?: Date;
  batchSize?: number;
  /**
   * How many rows to process in parallel within a single run. Each row is
   * one DoH lookup + 1 UPDATE. Set well below the Worker subrequest cap
   * (50 by default) so a single chunk has room to also retry against the
   * fallback resolver if the primary errors.
   */
  concurrency?: number;
  /**
   * Slightly under 24h so a row checked at hour H is considered due again
   * around hour H of the next day, accounting for the cron's natural
   * 5-minute jitter without delaying anyone by a full extra cycle.
   */
  staleAfterMs?: number;
  downgradeAfterFailures?: number;
  fetchImpl?: DohFetch;
} = {}): Promise<DomainRecheckStats> {
  const stats: DomainRecheckStats = {
    checked: 0,
    ok: 0,
    missed: 0,
    errored: 0,
    downgraded: [],
  };

  const cutoff = new Date(now.getTime() - staleAfterMs);
  const due = await db
    .select({
      id: auth_organization_verified_domains.id,
      organizationId: auth_organization_verified_domains.organizationId,
      apexDomain: auth_organization_verified_domains.apexDomain,
      recheckToken: auth_organization_verified_domains.recheckToken,
      consecutiveFailedChecks:
        auth_organization_verified_domains.consecutiveFailedChecks,
    })
    .from(auth_organization_verified_domains)
    .where(
      and(
        eq(auth_organization_verified_domains.verifiedVia, "dns_txt"),
        isNull(auth_organization_verified_domains.downgradedAt),
        or(
          isNull(auth_organization_verified_domains.lastCheckedAt),
          lt(auth_organization_verified_domains.lastCheckedAt, cutoff)
        )
      )
    )
    .orderBy(auth_organization_verified_domains.lastCheckedAt)
    .limit(batchSize);

  if (due.length === 0) {
    return stats;
  }

  for (let offset = 0; offset < due.length; offset += concurrency) {
    const chunk = due.slice(offset, offset + concurrency);
    const results = await Promise.all(
      chunk.map((row) =>
        processDueRow({
          row,
          now,
          downgradeAfterFailures,
          fetchImpl,
        }).catch(
          (): Awaited<ReturnType<typeof processDueRow>> => ({
            outcome: { kind: "errored" },
          })
        )
      )
    );

    for (const result of results) {
      stats.checked += 1;
      switch (result.outcome.kind) {
        case "ok":
          stats.ok += 1;
          break;
        case "miss":
          stats.missed += 1;
          break;
        case "downgraded":
          stats.missed += 1;
          if (result.downgraded) {
            stats.downgraded.push(result.downgraded);
          }
          break;
        case "errored":
          stats.errored += 1;
          break;
        default:
          stats.errored += 1;
      }
    }
  }

  return stats;
}

/**
 * Helper for the cron's email-fanout step: list owners of an org so a
 * downgrade notice can be addressed to them.
 */
export async function listOrgOwnerEmails(
  organizationId: string
): Promise<{ email: string; name: string }[]> {
  const rows = await db
    .select({
      email: auth_users.email,
      name: auth_users.name,
      role: auth_organization_members.role,
    })
    .from(auth_organization_members)
    .innerJoin(auth_users, eq(auth_users.id, auth_organization_members.userId))
    .where(eq(auth_organization_members.organizationId, organizationId));

  return rows
    .filter((r) => hasOrgRole(r.role, "owner"))
    .map((r) => ({ email: r.email, name: r.name }));
}
