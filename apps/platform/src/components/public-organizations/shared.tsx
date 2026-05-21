import {
	ArrowRight,
	type LucideIcon,
	ShieldCheck,
	ShieldQuestion,
} from "lucide-react";
import type { ReactNode } from "react";
import type { PublicOrganization } from "@/lib/api/public-organizations";

export function PublicPageShell({ children }: { children: ReactNode }) {
	return <>{children}</>;
}

export function formatOrganizationWebsite(value: string | null): string | null {
	if (!value) {
		return null;
	}

	try {
		return new URL(value).hostname;
	} catch {
		return value;
	}
}

export function PublicOrganizationAvatar({
	organization,
	size = "md",
}: {
	organization: PublicOrganization;
	size?: "lg" | "md";
}) {
	const sizeClassName = size === "lg" ? "size-14" : "size-10";

	if (organization.logo && organization.logo.trim().length > 0) {
		return (
			<img
				alt=""
				className={`${sizeClassName} rounded-md border border-border object-cover`}
				src={organization.logo}
			/>
		);
	}

	return (
		<div
			aria-hidden="true"
			className={`${sizeClassName} flex items-center justify-center rounded-md border border-border bg-muted font-medium text-base sm:text-sm`}
		>
			{organization.name.slice(0, 1).toUpperCase()}
		</div>
	);
}

export function PublicOrganizationMeta({
	organization,
}: {
	organization: PublicOrganization;
}) {
	const websiteHost = formatOrganizationWebsite(organization.website);
	const firstDomain = organization.verified_apex_domains[0] ?? null;

	if (!(websiteHost || firstDomain)) {
		return null;
	}

	return (
		<p className="text-base text-muted-foreground sm:text-sm">
			{websiteHost ?? firstDomain}
		</p>
	);
}

export function EmptyOrganizationSearchState({
	children,
}: {
	children: ReactNode;
}) {
	return (
		<div className="rounded-md border border-border p-6 text-base text-muted-foreground sm:text-sm">
			{children}
		</div>
	);
}

export function PublicOrganizationSearchResults({
	emptyMessage,
	getHref,
	organizations,
}: {
	emptyMessage: string;
	getHref: (organization: PublicOrganization) => string;
	organizations: PublicOrganization[];
}) {
	if (organizations.length === 0) {
		return (
			<EmptyOrganizationSearchState>
				{emptyMessage}
			</EmptyOrganizationSearchState>
		);
	}

	return (
		<ul className="list-none divide-y divide-border rounded-md border border-border">
			{organizations.map((organization) => (
				<li key={organization.id}>
					<a
						className="group flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/50"
						href={getHref(organization)}
					>
						<div className="flex min-w-0 items-center gap-3">
							<PublicOrganizationAvatar organization={organization} />
							<div className="min-w-0">
								<p className="truncate font-medium text-base sm:text-sm">
									{organization.name}
								</p>
								<PublicOrganizationMeta organization={organization} />
							</div>
						</div>
						<ArrowRight
							aria-hidden="true"
							className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 sm:size-4"
						/>
					</a>
				</li>
			))}
		</ul>
	);
}

function StatusCallout({
	description,
	icon: Icon,
	tone,
	title,
}: {
	description: string;
	icon: LucideIcon;
	tone: "emerald" | "red";
	title: string;
}) {
	const toneClassName =
		tone === "emerald"
			? "border-emerald-200 bg-emerald-50/60 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
			: "border-red-200 bg-red-50/60 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200";
	const iconClassName =
		tone === "emerald"
			? "text-emerald-700 dark:text-emerald-400"
			: "text-red-500";
	const descriptionClassName =
		tone === "emerald"
			? "text-emerald-700 dark:text-emerald-300"
			: "text-red-700 dark:text-red-300";

	return (
		<div
			className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${toneClassName}`}
		>
			<Icon
				aria-hidden="true"
				className={`mt-0.5 size-5 shrink-0 ${iconClassName}`}
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-base sm:text-sm">{title}</p>
				<p
					className={`mt-1 text-base text-pretty sm:text-sm ${descriptionClassName}`}
				>
					{description}
				</p>
			</div>
		</div>
	);
}

export function OwnerVerificationCallout({ verified }: { verified: boolean }) {
	if (verified) {
		return (
			<StatusCallout
				description="Kayle ID has completed an owner identity check for this organization."
				icon={ShieldCheck}
				title="Owner ID check completed"
				tone="emerald"
			/>
		);
	}

	return (
		<StatusCallout
			description="Kayle ID has not completed an owner identity check for this organization."
			icon={ShieldQuestion}
			title="Owner ID check not completed"
			tone="red"
		/>
	);
}

export function IntegrationTermsCallout() {
	return (
		<StatusCallout
			description="This organization has agreed to the Kayle ID Integration Terms."
			icon={ShieldCheck}
			title="Integration terms accepted"
			tone="emerald"
		/>
	);
}
