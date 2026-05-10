import OctagonCheck from "@kayle-id/ui/icons/octagon-check";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import type { SVGProps } from "react";
import { getPlatformNameLabel } from "./platform-name";

export type Organization = {
	name: string | null;
	ownerIdCheckCompleted: boolean;
	/**
	 * All apex domains the org has actively verified, in stable order. The
	 * verified-domain badge cross-checks the policy/website links against
	 * this list so the badge only appears when the user-clickable links
	 * actually go to a Kayle-verified host.
	 */
	verifiedApexDomains: string[];
	logo: string | null;
	/**
	 * "sole" relabels the legal-entity fields below to their individual
	 * equivalents in the dialog (Full name / Country / Tax or trader ID).
	 * "business" or null keeps the registered-entity wording.
	 */
	businessType: "sole" | "business" | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
	privacyPolicyUrl: string | null;
	termsOfServiceUrl: string | null;
	website: string | null;
	description: string | null;
};

/**
 * Decide whether the verified-domain badge should appear on this org's
 * details dialog, and which apex(es) to show inside it.
 *
 * Rule: every present policy/website URL (website, privacy policy, terms
 * of service) must resolve to one of the org's actively verified apex
 * domains — equal to the apex or a subdomain of it. If any URL is on a
 * non-verified host, or there are no URLs to anchor against, the badge
 * is hidden. Returning the unique sorted set of matched apexes lets the
 * badge display exactly which domains were anchored against.
 */
function selectBadgeApexDomains(organization: Organization): string[] | null {
	if (organization.verifiedApexDomains.length === 0) {
		return null;
	}
	const candidateUrls = [
		organization.website,
		organization.privacyPolicyUrl,
		organization.termsOfServiceUrl,
	].filter((value): value is string => Boolean(value));
	if (candidateUrls.length === 0) {
		return null;
	}
	const matched = new Set<string>();
	for (const rawUrl of candidateUrls) {
		const host = extractHostname(rawUrl);
		if (!host) {
			return null;
		}
		const apex = organization.verifiedApexDomains.find(
			(candidate) => host === candidate || host.endsWith(`.${candidate}`),
		);
		if (!apex) {
			return null;
		}
		matched.add(apex);
	}
	return Array.from(matched).sort();
}

function extractHostname(rawUrl: string): string | null {
	try {
		return new URL(rawUrl).hostname.toLowerCase();
	} catch {
		return null;
	}
}

const ORG_NAME_TRIGGER_CLASSES =
	"font-bold text-foreground underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const ORG_NAME_TRIGGER_DIM_CLASSES =
	"font-medium underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type OrganizationNameProps = {
	organization: Organization;
	dim?: boolean;
	isAgeOnly?: boolean;
};

/**
 * Renders the relying party's display name as an inline trigger that opens a
 * dialog with the additional org details we expose to end users (legal name,
 * jurisdiction, registration number, verification status). The trigger styling
 * mirrors the dashed-underline cue used elsewhere so the affordance is
 * consistent across the verify flow.
 */
export function OrganizationName({
	organization,
	dim = false,
	isAgeOnly = false,
}: OrganizationNameProps) {
	const platformName = getPlatformNameLabel(organization.name);
	const triggerClassName = dim
		? ORG_NAME_TRIGGER_DIM_CLASSES
		: ORG_NAME_TRIGGER_CLASSES;

	return (
		<Dialog>
			<DialogTrigger
				className={triggerClassName}
				render={<button type="button" />}
			>
				{platformName}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="text-lg">About {platformName}</DialogTitle>
					<DialogDescription>
						To help protect you, we're showing you some information about the
						organization requesting this check.
					</DialogDescription>
				</DialogHeader>

				<OrganizationIdentityCard
					description={organization.description}
					hasVerifiedDomain={organization.verifiedApexDomains.length > 0}
					logo={organization.logo}
					name={platformName}
				/>
				<div className="flex flex-col gap-2">
					<VerificationStatusCallout
						isAgeOnly={isAgeOnly}
						verified={organization.ownerIdCheckCompleted}
					/>
					<OrganizationDetailsList organization={organization} />
					{(() => {
						const badgeApexes = selectBadgeApexDomains(organization);
						return badgeApexes ? (
							<VerifiedDomainBadge apexDomains={badgeApexes} />
						) : null;
					})()}
					<OrganizationPolicyLinks organization={organization} />
				</div>

				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

function OrganizationIdentityCard({
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
	const initial = name.charAt(0).toUpperCase();
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
						{initial}
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

function VerifiedDomainBadge({ apexDomains }: { apexDomains: string[] }) {
	const isPlural = apexDomains.length > 1;
	return (
		<div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
			<OctagonCheck
				aria-hidden="true"
				className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-emerald-800 text-sm dark:text-emerald-200">
					{isPlural ? "Verified domains" : "Verified domain"}
				</p>
				<p className="mt-1 break-all font-mono text-emerald-700 text-sm dark:text-emerald-300">
					{apexDomains.join(", ")}
				</p>
				<p className="mt-1 text-emerald-700 text-xs dark:text-emerald-300">
					{isPlural
						? "Kayle ID confirmed control of these domains. The website and policy links shown here all point to them."
						: "Kayle ID confirmed control of this domain. The website and policy links shown here all point to it."}
				</p>
			</div>
		</div>
	);
}

function OrganizationDetailsList({
	organization,
}: {
	organization: Organization;
}) {
	if (organization.verifiedApexDomains.length === 0) {
		return null;
	}

	// Sole-trader orgs get individual-style labels for the same three columns
	// (the data is conceptually different — a person, not a registered
	// entity — so the wording shouldn't pretend otherwise). Anything else
	// (the typical "business" case, or `null` for orgs that haven't picked)
	// gets the registered-entity defaults.
	const isSoleTrader = organization.businessType === "sole";
	const labels = isSoleTrader
		? {
				name: "Full name",
				jurisdiction: "Country",
				registrationNumber: "Tax / trader ID",
			}
		: {
				name: "Legal name",
				jurisdiction: "Registered in",
				registrationNumber: "Registration number",
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

function OrganizationPolicyLinks({
	organization,
}: {
	organization: Organization;
}) {
	const links: { label: string; href: string }[] = [];

	if (organization.website) {
		links.push({ label: "Website", href: organization.website });
	}
	if (organization.privacyPolicyUrl) {
		links.push({
			label: "Privacy policy",
			href: organization.privacyPolicyUrl,
		});
	}
	if (organization.termsOfServiceUrl) {
		links.push({
			label: "Terms of service",
			href: organization.termsOfServiceUrl,
		});
	}

	if (links.length === 0) {
		return null;
	}

	return (
		<ul className="flex flex-col gap-2">
			{links.map((link) => (
				<li key={link.href}>
					<a
						className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 transition-colors hover:border-border/80 hover:bg-muted"
						href={link.href}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span className="font-medium text-foreground text-sm">
							{link.label}
						</span>
						<ArrowUpRightIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
						/>
					</a>
				</li>
			))}
		</ul>
	);
}

function ArrowUpRightIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<title>Opens in a new tab</title>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}

function VerificationStatusCallout({
	verified,
	isAgeOnly,
}: {
	verified: boolean;
	isAgeOnly: boolean;
}) {
	if (verified) {
		return (
			<div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
				<OctagonCheck
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-emerald-800 text-sm dark:text-emerald-200">
						Owner ID check completed
					</p>
					<p className="mt-1 text-emerald-700 text-sm dark:text-emerald-300">
						The people running this organization have completed Kayle ID's owner
						identity check.
					</p>
				</div>
			</div>
		);
	}

	// Age-only sessions only share a yes/no age answer — no PII, no document
	// data — so an unverified org carries lower stakes than for a full ID check.
	// Soften the warning to amber to match that risk level.
	if (isAgeOnly) {
		return (
			<div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40">
				<OctagonWarning
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-amber-500"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-amber-800 text-sm dark:text-amber-200">
						Owner ID check not completed
					</p>
					<p className="mt-1 text-amber-700 text-sm text-pretty dark:text-amber-300">
						Kayle ID has not independently verified the people running this
						organization. Only continue if you trust this request.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 dark:border-red-900 dark:bg-red-950/40">
			<OctagonWarning
				aria-hidden="true"
				className="mt-0.5 size-5 shrink-0 text-red-500"
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-red-800 text-sm dark:text-red-200">
					Owner ID check not completed
				</p>
				<p className="mt-1 text-red-700 text-sm text-pretty dark:text-red-300">
					Kayle ID has not independently verified the people running this
					organization. Only continue if you trust this request.
				</p>
			</div>
		</div>
	);
}
