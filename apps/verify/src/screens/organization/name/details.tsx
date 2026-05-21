import { useVerifyHandoffCopy } from "@/i18n/provider";
import type { Organization } from "../types";

export function OrganizationIdentityCard({
	description,
	hasVerifiedDomain,
	logo,
	name,
}: {
	description: string | null;
	hasVerifiedDomain: boolean;
	logo: string | null;
	name: string;
}) {
	const showLogo = hasVerifiedDomain && logo !== null;

	return (
		<div className="flex items-start gap-3">
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
				{showLogo ? (
					<img
						alt=""
						className="size-full object-cover"
						height={48}
						src={logo}
						width={48}
					/>
				) : (
					<span aria-hidden="true" className="font-medium text-foreground">
						{name.charAt(0).toUpperCase()}
					</span>
				)}
			</div>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-base text-foreground">{name}</p>
				{description ? (
					<p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
				) : null}
			</div>
		</div>
	);
}

export function OrganizationDetailsList({
	organization,
}: {
	organization: Organization;
}) {
	const { org } = useVerifyHandoffCopy();

	if (organization.verifiedApexDomains.length === 0) {
		return null;
	}

	// Sole-trader orgs get individual-style labels for the same three columns
	// since the data is conceptually different — a person, not a registered entity.
	const isSoleTrader = organization.businessType === "sole";
	const labels = isSoleTrader
		? {
				name: org.soleTraderNameLabel,
				jurisdiction: org.soleTraderJurisdictionLabel,
				registrationNumber: org.soleTraderRegistrationLabel,
			}
		: {
				name: org.businessNameLabel,
				jurisdiction: org.businessJurisdictionLabel,
				registrationNumber: org.businessRegistrationLabel,
			};

	const items: { label: string; value: string }[] = [];
	if (organization.businessName) {
		items.push({ label: labels.name, value: organization.businessName });
	}
	if (organization.businessJurisdiction) {
		items.push({
			label: labels.jurisdiction,
			value: organization.businessJurisdiction,
		});
	}
	if (organization.businessRegistrationNumber) {
		items.push({
			label: labels.registrationNumber,
			value: organization.businessRegistrationNumber,
		});
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/40 px-4 py-1 text-sm">
			{items.map((item) => (
				<div
					className="flex items-center justify-between gap-4 py-2.5"
					key={item.label}
				>
					<dt className="text-muted-foreground">{item.label}</dt>
					<dd className="break-all text-right font-medium text-foreground">
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}
