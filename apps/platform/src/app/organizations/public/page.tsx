import { Button } from "@kayle-id/ui/components/button";
import { Input } from "@kayle-id/ui/components/input";
import { Link } from "@tanstack/react-router";
import {
	AlertCircle,
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	Building2,
	ExternalLink,
	type LucideIcon,
	Mail,
	Search,
} from "lucide-react";
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useId,
	useState,
} from "react";
import {
	IntegrationTermsCallout,
	OwnerVerificationCallout,
	PublicOrganizationAvatar,
	PublicPageShell,
} from "@/components/public-organizations/shared";
import type {
	PublicOrganization,
	PublicOrganizationsPagination,
} from "@/lib/api/public-organizations";

function MarketingHeading({
	children,
	className = "",
}: {
	children: string;
	className?: string;
}) {
	return (
		<h1
			className={`max-w-[14ch] wrap-break-word text-balance font-light text-6xl text-foreground tracking-tighter sm:text-7xl ${className}`}
		>
			{children}
		</h1>
	);
}

function OrganizationResultCard({
	organization,
}: {
	organization: PublicOrganization;
}) {
	return (
		<a
			className="group flex flex-col justify-between rounded-2xl border border-border/70 bg-card/70 p-5 transition-colors hover:border-foreground/20 hover:bg-card"
			href={buildOrganizationHref(organization)}
		>
			<div className="flex items-center gap-4">
				<PublicOrganizationAvatar organization={organization} size="lg" />
				<div className="min-w-0 flex-1">
					<h3 className="truncate font-light text-xl text-foreground tracking-tight">
						{organization.name}
					</h3>
					{organization.description ? (
						<p className="line-clamp-2 text-base text-muted-foreground text-pretty sm:text-sm">
							{organization.description}
						</p>
					) : null}
				</div>
				<ArrowUpRight
					aria-hidden="true"
					className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground"
				/>
			</div>
		</a>
	);
}

function SearchResultsSection({
	error,
	organizations,
	pagination,
	query,
}: {
	error: null | string;
	organizations: PublicOrganization[];
	pagination: PublicOrganizationsPagination;
	query: string;
}) {
	if (error) {
		return (
			<div className="flex items-start gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-base text-destructive sm:text-sm">
				<AlertCircle
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 sm:size-4"
				/>
				<p>{error}</p>
			</div>
		);
	}

	return (
		<div className="mt-8 flex flex-col gap-1">
			{organizations.map((organization) => (
				<OrganizationResultCard
					key={organization.id}
					organization={organization}
				/>
			))}
			{organizations.length === 0 ? (
				<div className="rounded-2xl border border-border/70 p-6">
					<h2 className="font-light text-3xl text-foreground tracking-tighter">
						{query ? "No organizations found." : "No organizations listed yet."}
					</h2>
				</div>
			) : null}
			<OrganizationsPaginationControls pagination={pagination} query={query} />
		</div>
	);
}

function buildOrganizationHref(organization: PublicOrganization): string {
	return `/organizations/${encodeURIComponent(organization.slug || organization.id)}`;
}

function buildOrganizationsPageHref({
	page,
	query,
}: {
	page: number;
	query: string;
}): string {
	const searchParams = new URLSearchParams();
	if (query) {
		searchParams.set("query", query);
	}
	if (page > 1) {
		searchParams.set("page", String(page));
	}

	const serialized = searchParams.toString();
	return serialized ? `/organizations?${serialized}` : "/organizations";
}

function OrganizationsPaginationControls({
	pagination,
	query,
}: {
	pagination: PublicOrganizationsPagination;
	query: string;
}) {
	if (!(pagination.has_previous_page || pagination.has_next_page)) {
		return null;
	}

	return (
		<nav
			aria-label="Organizations pages"
			className="mt-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center"
		>
			<p className="text-muted-foreground text-sm">Page {pagination.page}</p>
			<div className="flex gap-2">
				{pagination.has_previous_page ? (
					<Button
						nativeButton={false}
						render={
							<a
								href={buildOrganizationsPageHref({
									page: Math.max(1, pagination.page - 1),
									query,
								})}
							>
								<ArrowLeft aria-hidden="true" className="size-4" />
								Previous
							</a>
						}
						variant="outline"
					/>
				) : null}
				{pagination.has_next_page ? (
					<Button
						nativeButton={false}
						render={
							<a
								href={buildOrganizationsPageHref({
									page: pagination.page + 1,
									query,
								})}
							>
								Next
								<ArrowRight aria-hidden="true" className="size-4" />
							</a>
						}
						variant="outline"
					/>
				) : null}
			</div>
		</nav>
	);
}

export function PublicOrganizationsSearchPage({
	error,
	onSearch,
	organizations,
	pagination,
	query,
}: {
	error: null | string;
	onSearch: (query: string) => void;
	organizations: PublicOrganization[];
	pagination: PublicOrganizationsPagination;
	query: string;
}) {
	const [draftQuery, setDraftQuery] = useState(query);
	const searchId = useId();

	useEffect(() => {
		setDraftQuery(query);
	}, [query]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		onSearch(draftQuery.trim());
	};

	return (
		<PublicPageShell>
			<main className="mx-auto max-w-7xl px-6 py-24 lg:px-8 space-y-12">
				<section className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
					<div>
						<MarketingHeading className="mt-8">
							Organizations using Kayle ID.
						</MarketingHeading>
						<p className="mt-6 max-w-[58ch] text-base text-muted-foreground text-pretty sm:text-xl">
							This public directory lists organizations using Kayle ID that have
							agreed to abide by the Kayle ID Integration Terms.
						</p>
						<form
							action="/organizations"
							className="mt-10 flex max-w-2xl flex-col gap-3 sm:flex-row"
							method="get"
							onSubmit={handleSubmit}
						>
							<div className="min-w-0 flex-1">
								<label className="sr-only" htmlFor={searchId}>
									Organization
								</label>
								<Input
									id={searchId}
									name="query"
									onChange={(event) => setDraftQuery(event.target.value)}
									placeholder="Organization name, slug, domain, or ID"
									type="search"
									value={draftQuery}
								/>
							</div>
							<Button type="submit">
								<Search aria-hidden="true" className="size-4" />
								Search
							</Button>
						</form>
					</div>
				</section>

				<SearchResultsSection
					error={error}
					organizations={organizations}
					pagination={pagination}
					query={query}
				/>
			</main>
		</PublicPageShell>
	);
}

function ProfileSection({
	children,
	description,
	title,
}: {
	children: ReactNode;
	description?: string;
	title: string;
}) {
	return (
		<section className="border-border/70 border-t pt-7 first:border-t-0 first:pt-0">
			<div className="mb-4">
				<h2 className="font-light text-2xl text-foreground tracking-tighter">
					{title}
				</h2>
				{description ? (
					<p className="mt-2 text-base text-muted-foreground text-pretty sm:text-sm">
						{description}
					</p>
				) : null}
			</div>
			{children}
		</section>
	);
}

interface OrganizationDetailItem {
	label: string;
	value: string;
}

function getOrganizationDetailItems(
	organization: PublicOrganization,
): OrganizationDetailItem[] {
	const isSoleTrader = organization.business_type === "sole";
	const labels = isSoleTrader
		? {
				jurisdiction: "Country",
				name: "Full name",
				registrationNumber: "Tax or trader ID",
			}
		: {
				jurisdiction: "Business jurisdiction",
				name: "Registered business name",
				registrationNumber: "Registration number",
			};
	const items: OrganizationDetailItem[] = [];

	if (organization.business_name) {
		items.push({ label: labels.name, value: organization.business_name });
	}
	if (organization.business_jurisdiction) {
		items.push({
			label: labels.jurisdiction,
			value: organization.business_jurisdiction,
		});
	}
	if (organization.business_registration_number) {
		items.push({
			label: labels.registrationNumber,
			value: organization.business_registration_number,
		});
	}

	return items;
}

function VerifiedDomainsTable({ domains }: { domains: string[] }) {
	if (domains.length === 0) {
		return null;
	}

	return (
		<div className="-my-2 overflow-x-auto whitespace-nowrap">
			<div className="inline-block min-w-full py-2 align-middle">
				<table className="w-full text-left text-base sm:text-sm">
					<thead>
						<tr className="border-border/70 border-b">
							<th className="whitespace-nowrap py-2 pr-4 font-medium text-foreground">
								Domain
							</th>
							<th className="whitespace-nowrap py-2 pl-4 text-right font-medium text-foreground">
								Status
							</th>
						</tr>
					</thead>
					<tbody className="divide-border/60 divide-y">
						{domains.map((domain) => (
							<tr key={domain}>
								<td className="break-all py-3 pr-4 font-mono text-muted-foreground">
									{domain}
								</td>
								<td className="py-3 pl-4 text-right font-medium text-emerald-700 dark:text-emerald-400">
									Verified
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function OrganizationDetailsList({
	items,
}: {
	items: OrganizationDetailItem[];
}) {
	if (items.length === 0) {
		return null;
	}

	return (
		<dl className="divide-border/60 divide-y text-base sm:text-sm">
			{items.map((item) => (
				<div
					className="grid gap-1 py-3 sm:grid-cols-[minmax(0,0.42fr)_minmax(0,0.58fr)] sm:gap-4"
					key={item.label}
				>
					<dt className="font-medium text-foreground">{item.label}</dt>
					<dd className="break-all text-muted-foreground sm:text-right">
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

interface OrganizationExternalLink {
	href: string;
	host: string;
	icon: LucideIcon;
	label: string;
	path: string | null;
}

function getExternalLinkParts(href: string): {
	host: string;
	path: string | null;
} {
	if (href.startsWith("mailto:")) {
		return {
			host: href.replace("mailto:", ""),
			path: null,
		};
	}

	try {
		const url = new URL(href);
		const path = `${url.pathname}${url.search}${url.hash}`;

		return {
			host: url.hostname,
			path: path.replace(/\/+$/, "").length > 1 ? path : null,
		};
	} catch {
		return {
			host: href,
			path: null,
		};
	}
}

function buildExternalLink({
	href,
	icon = ExternalLink,
	label,
}: {
	href: string | null;
	icon?: LucideIcon;
	label: string;
}): OrganizationExternalLink | null {
	if (!href) {
		return null;
	}

	const linkParts = getExternalLinkParts(href);

	return {
		href,
		host: linkParts.host,
		icon,
		label,
		path: linkParts.path,
	};
}

function getOrganizationExternalLinks(
	organization: PublicOrganization,
): OrganizationExternalLink[] {
	const links = [
		buildExternalLink({
			href: organization.website,
			label: "Website",
		}),
		buildExternalLink({
			href: organization.privacy_policy_url,
			label: "Privacy policy",
		}),
		buildExternalLink({
			href: organization.terms_of_service_url,
			label: "Terms of service",
		}),
		buildExternalLink({
			href: organization.rp_fallback.support_email
				? `mailto:${organization.rp_fallback.support_email}`
				: null,
			icon: Mail,
			label: "Support email",
		}),
		buildExternalLink({
			href: organization.rp_fallback.appeal_url,
			label: "Appeal",
		}),
		buildExternalLink({
			href: organization.rp_fallback.complaints_url,
			label: "Complaints",
		}),
		buildExternalLink({
			href: organization.rp_fallback.fallback_idv_url,
			label: "Fallback verification",
		}),
	];

	return links.filter((link): link is OrganizationExternalLink =>
		Boolean(link),
	);
}

function OrganizationLinksGrid({
	links,
}: {
	links: OrganizationExternalLink[];
}) {
	if (links.length === 0) {
		return null;
	}

	return (
		<ul className="grid list-none gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{links.map((link) => {
				const Icon = link.icon;
				return (
					<li key={`${link.label}:${link.href}`}>
						<a
							className="group flex min-h-24 items-start justify-between gap-3 rounded-xl border border-border/70 bg-card/70 p-4 transition-colors hover:border-foreground/20 hover:bg-card"
							href={link.href}
							rel={
								link.href.startsWith("mailto:")
									? undefined
									: "noopener noreferrer"
							}
							target={link.href.startsWith("mailto:") ? undefined : "_blank"}
						>
							<span className="min-w-0">
								<span className="block font-medium text-base text-foreground sm:text-sm">
									{link.label}
								</span>
								<span className="mt-1.5 block break-all text-base text-muted-foreground sm:text-sm">
									<span className="font-semibold text-foreground/75">
										{link.host}
									</span>
									{link.path}
								</span>
							</span>
							<Icon
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
							/>
						</a>
					</li>
				);
			})}
		</ul>
	);
}

function OrganizationProfile({
	organization,
}: {
	organization: PublicOrganization;
}) {
	const detailItems = getOrganizationDetailItems(organization);
	const externalLinks = getOrganizationExternalLinks(organization);

	return (
		<div className="space-y-8">
			<ProfileSection
				description="Directory visibility and identity checks for this organization."
				title="Trust status"
			>
				<div className="grid gap-3 lg:grid-cols-2">
					<IntegrationTermsCallout />
					<OwnerVerificationCallout
						verified={organization.owner_id_check_completed}
					/>
				</div>
			</ProfileSection>

			{organization.verified_apex_domains.length > 0 ? (
				<ProfileSection
					description={`Below are domains that Kayle ID has verified are controlled by ${organization.name}${organization.name.endsWith(".") ? "" : "."}`}
					title="Domains"
				>
					<VerifiedDomainsTable domains={organization.verified_apex_domains} />
				</ProfileSection>
			) : null}

			{detailItems.length > 0 ? (
				<ProfileSection
					title="Business details"
					description={`Below are business details for ${organization.name}${organization.name.endsWith(".") ? "" : "."}`}
				>
					<OrganizationDetailsList items={detailItems} />
				</ProfileSection>
			) : null}

			{externalLinks.length > 0 ? (
				<ProfileSection
					description="Official pages and support routes published by this organization."
					title="External links"
				>
					<OrganizationLinksGrid links={externalLinks} />
				</ProfileSection>
			) : null}
		</div>
	);
}

export function PublicOrganizationProfilePage({
	error,
	organization,
}: {
	error: null | string;
	organization: PublicOrganization | null;
}) {
	return (
		<PublicPageShell>
			<main className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
				{error || !organization ? (
					<section className="mt-10 max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-destructive">
						<div className="flex items-start gap-3">
							<Building2 aria-hidden="true" className="mt-1 size-5 shrink-0" />
							<div>
								<h1 className="font-light text-3xl tracking-tighter">
									Organization not found.
								</h1>
								<p className="mt-2 text-base text-pretty">
									{error ??
										"The organization could not be found in the public directory."}
								</p>
							</div>
						</div>
					</section>
				) : (
					<section className="mt-10">
						<div className="flex flex-col gap-5">
							<PublicOrganizationAvatar organization={organization} size="lg" />
							<MarketingHeading>{organization.name}</MarketingHeading>
							{organization.description ? (
								<p className="max-w-[62ch] text-base text-muted-foreground text-pretty sm:text-xl">
									{organization.description}
								</p>
							) : null}
						</div>
						<div className="mt-8 flex flex-col gap-3 sm:flex-row">
							<Button
								render={
									<Link
										to="/organizations/$identifier/report"
										params={{
											identifier: encodeURIComponent(
												organization.slug || organization.id,
											),
										}}
									>
										Report organization
									</Link>
								}
							/>
							<Button
								render={<Link to="/organizations">Back to directory</Link>}
								variant="outline"
							/>
						</div>
						<div className="mt-14">
							<OrganizationProfile organization={organization} />
						</div>
					</section>
				)}
			</main>
		</PublicPageShell>
	);
}
