import { listOrgOwnerEmails } from "@kayle-id/auth/domain-verification/service";
import { env } from "@kayle-id/config/env";
import { db } from "@kayle-id/database/drizzle";
import { auth_organizations } from "@kayle-id/database/schema/auth";
import { sendDomainTakeoverNotice } from "@kayle-id/emails/send-domain-takeover-notice";
import { eq } from "drizzle-orm";

export async function notifyDomainTakeover({
	apexDomain,
	previousOrganizationId,
	takingOverOrganizationId,
}: {
	apexDomain: string;
	previousOrganizationId: string;
	takingOverOrganizationId: string;
}): Promise<void> {
	if (process.env.NODE_ENV !== "production") {
		return;
	}

	const [previousOrg] = await db
		.select({ name: auth_organizations.name })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, previousOrganizationId))
		.limit(1);
	const [takingOverOrg] = await db
		.select({ name: auth_organizations.name })
		.from(auth_organizations)
		.where(eq(auth_organizations.id, takingOverOrganizationId))
		.limit(1);
	const owners = await listOrgOwnerEmails(previousOrganizationId);
	const domainsUrl = new URL(
		"/settings/organizations/domains",
		env.PUBLIC_AUTH_URL,
	).toString();

	await Promise.all(
		owners.map((owner) =>
			sendDomainTakeoverNotice({
				apexDomain,
				binding: env.SEND_EMAIL,
				domainsUrl,
				from: env.EMAIL_FROM_ADDRESS,
				organizationName: previousOrg?.name ?? "your organization",
				takingOverOrganizationName:
					takingOverOrg?.name ?? "another organization",
				to: owner.email,
			}),
		),
	);
}
