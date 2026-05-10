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
	verified: boolean;
	logo: string | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
	privacyPolicyUrl: string | null;
	termsOfServiceUrl: string | null;
	website: string | null;
	description: string | null;
};

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
					logo={organization.logo}
					name={platformName}
				/>
				<OrganizationDetailsList organization={organization} />
				<div className="flex flex-col gap-2">
					<VerificationStatusCallout
						isAgeOnly={isAgeOnly}
						verified={organization.verified}
					/>
					<OrganizationPolicyLinks organization={organization} />
				</div>

				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

function OrganizationIdentityCard({
	description,
	logo,
	name,
}: {
	description: string | null;
	logo: string | null;
	name: string;
}) {
	const initial = name.charAt(0).toUpperCase();

	return (
		<div className="flex items-start gap-3">
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
				{logo ? (
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

function OrganizationDetailsList({
	organization,
}: {
	organization: Organization;
}) {
	const items: { label: string; value: string }[] = [];

	if (organization.businessName) {
		items.push({ label: "Legal name", value: organization.businessName });
	}
	if (organization.businessJurisdiction) {
		items.push({
			label: "Registered in",
			value: organization.businessJurisdiction,
		});
	}
	if (organization.businessRegistrationNumber) {
		items.push({
			label: "Registration number",
			value: organization.businessRegistrationNumber,
		});
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<dl className="grid grid-cols-1 gap-3 text-sm">
			{items.map((item) => (
				<div className="flex flex-col" key={item.label}>
					<dt className="text-muted-foreground text-xs">{item.label}</dt>
					<dd className="font-medium text-foreground">{item.value}</dd>
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
			<div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
				<OctagonCheck
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-emerald-700"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-emerald-800 text-sm">
						Owner ID check completed
					</p>
					<p className="mt-1 text-emerald-700 text-sm">
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
			<div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
				<OctagonWarning
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-amber-500"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-amber-800 text-sm">
						Owner ID check not completed
					</p>
					<p className="mt-1 text-amber-700 text-sm text-pretty">
						Kayle ID has not independently verified the people running this
						organization. Only continue if you trust this request.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3">
			<OctagonWarning
				aria-hidden="true"
				className="mt-0.5 size-5 shrink-0 text-red-500"
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-red-800 text-sm">
					Owner ID check not completed
				</p>
				<p className="mt-1 text-red-700 text-sm text-pretty">
					Kayle ID has not independently verified the people running this
					organization. Only continue if you trust this request.
				</p>
			</div>
		</div>
	);
}
