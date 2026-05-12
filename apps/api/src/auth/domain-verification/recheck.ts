import {
	listOrgOwnerEmails,
	runDomainReverification,
} from "@kayle-id/auth/domain-verification/service";
import {
	dnsRecordNameForApex,
	formatDnsRecordValue,
} from "@kayle-id/auth/domain-verification/tokens";
import {
	createSafeRequestLogger,
	logEvent,
	logSafeError,
} from "@kayle-id/config/logging";
import { db } from "@kayle-id/database/drizzle";
import {
	auth_organization_verified_domains,
	auth_organizations,
} from "@kayle-id/database/schema/auth";
import { sendDomainDowngradeNotice } from "@kayle-id/emails/send-domain-downgrade-notice";
import { eq } from "drizzle-orm";

interface CronEnv {
	EMAIL_FROM_ADDRESS: string;
	SEND_EMAIL: NonNullable<CloudflareBindings["SEND_EMAIL"]>;
	PUBLIC_AUTH_URL: string;
}

/**
 * Daily cron entry: re-verify DNS-method domain rows that haven't been
 * checked in 24h. Soft-fails on infra errors; downgrades + emails owners
 * after `downgradeAfterFailures` consecutive misses.
 *
 * Mirrors the shape of `refreshAppAttestReceipts` so the existing scheduled
 * Cron trigger can dispatch this without adding a new schedule.
 */
export async function runDomainReverificationCron({
	env,
	now = new Date(),
}: {
	env: CronEnv;
	now?: Date;
}): Promise<void> {
	const log = createSafeRequestLogger(
		new Request("https://kayle.invalid/internal/domain-recheck", {
			method: "POST",
		}),
	);

	let stats: Awaited<ReturnType<typeof runDomainReverification>>;
	try {
		stats = await runDomainReverification({ now });
	} catch (error) {
		logSafeError(log, {
			code: "domain_recheck_failed",
			error,
			event: "verify.domain_recheck.failed",
			message: "Domain re-verification cron threw.",
			status: 500,
		});
		log.emit({ _forceKeep: true });
		return;
	}

	logEvent(log, {
		details: {
			checked: stats.checked,
			ok: stats.ok,
			missed: stats.missed,
			errored: stats.errored,
			downgraded: stats.downgraded.length,
		},
		event: "verify.domain_recheck.completed",
	});

	for (const row of stats.downgraded) {
		try {
			const [{ recheckToken } = { recheckToken: null }] = await db
				.select({
					recheckToken: auth_organization_verified_domains.recheckToken,
				})
				.from(auth_organization_verified_domains)
				.where(eq(auth_organization_verified_domains.id, row.domainId))
				.limit(1);

			const [{ name: orgName } = { name: "your organization" }] = await db
				.select({ name: auth_organizations.name })
				.from(auth_organizations)
				.where(eq(auth_organizations.id, row.organizationId))
				.limit(1);

			const owners = await listOrgOwnerEmails(row.organizationId);
			const recordName = dnsRecordNameForApex(row.apexDomain);
			const recordValue = recheckToken
				? formatDnsRecordValue(recheckToken)
				: "kayle-id-verification=<re-issue from the Domains page>";
			const domainsUrl = new URL(
				"/organizations/domains",
				env.PUBLIC_AUTH_URL,
			).toString();

			if (process.env.NODE_ENV === "production") {
				await Promise.all(
					owners.map((owner) =>
						sendDomainDowngradeNotice({
							apexDomain: row.apexDomain,
							binding: env.SEND_EMAIL,
							domainsUrl,
							from: env.EMAIL_FROM_ADDRESS,
							organizationName: orgName,
							recordName,
							recordValue,
							to: owner.email,
						}),
					),
				);
			}

			logEvent(log, {
				details: {
					organization_id: row.organizationId,
					domain_id: row.domainId,
					apex_domain: row.apexDomain,
					notified_owner_count: owners.length,
				},
				event: "verify.domain_recheck.downgraded",
			});
		} catch (error) {
			logSafeError(log, {
				code: "domain_downgrade_notify_failed",
				details: {
					organization_id: row.organizationId,
					domain_id: row.domainId,
					apex_domain: row.apexDomain,
				},
				error,
				event: "verify.domain_recheck.notify_failed",
				message: "Failed to email owners after downgrade.",
				status: 500,
			});
		}
	}

	log.emit({ _forceKeep: true });
}

/**
 * True every 5 minutes (288× per day). Each invocation picks up to
 * `batchSize` rows whose last check is older than ~23h, processes them in
 * parallel chunks, and exits — so the per-run cost stays small while the
 * fleet of verified domains can scale into the tens of thousands without
 * any one row going stale longer than ~24h. Empty runs (no due rows)
 * exit after a single SELECT.
 *
 * Offset by 2 minutes from the top so we don't pile on with the other
 * cron predicates that fire at minute 0 / 7.
 */
export function shouldRunDomainReverification(scheduledMs: number): boolean {
	return new Date(scheduledMs).getUTCMinutes() % 5 === 2;
}
