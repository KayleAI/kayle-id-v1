import { useAuth } from "@kayle-id/auth/client/provider";
import { cn } from "@kayleai/ui/utils/cn";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import {
	fetchFullOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
} from "./api";
import { PendingDeletionBanner } from "./pending-deletion-banner";
import { UnverifiedOrgBanner } from "./unverified-org-banner";

interface TabDefinition {
	href:
		| "/organizations"
		| "/organizations/members"
		| "/organizations/settings"
		| "/organizations/public"
		| "/organizations/business"
		| "/organizations/compliance"
		| "/organizations/domains";
	label: string;
	requiresRole?: "admin";
}

const TABS: readonly TabDefinition[] = [
	{ href: "/organizations", label: "Overview" },
	{ href: "/organizations/members", label: "Members" },
	{ href: "/organizations/public", label: "Public details" },
	{ href: "/organizations/compliance", label: "Compliance" },
	{ href: "/organizations/business", label: "Business" },
	{ href: "/organizations/domains", label: "Domains" },
	{ href: "/organizations/settings", label: "Settings" },
] as const;

interface OrganizationPageLayoutProps {
	button?: ReactNode;
	children: ReactNode;
	description?: string;
	title: string;
}

function roleSatisfies(
	role: OrganizationRole | undefined,
	required: "admin" | undefined,
): boolean {
	if (!required) {
		return true;
	}
	return role === "owner" || role === "admin";
}

export function OrganizationPageLayout({
	button,
	children,
	description,
	title,
}: OrganizationPageLayoutProps) {
	const { location } = useRouterState();
	const currentPath = location.pathname.replace(/\/$/, "");
	const { activeOrganization, user } = useAuth();
	const pendingDeletionAt = activeOrganization?.pendingDeletionAt ?? null;
	// Reuse the cached org query the page itself will fetch (TanStack Query
	// dedupes), so we don't issue a second request just to gate tab visibility.
	const { data: org } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});
	const currentRole = org?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const visibleTabs = TABS.filter((tab) =>
		roleSatisfies(currentRole, tab.requiresRole),
	);

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			{pendingDeletionAt ? (
				<PendingDeletionBanner pendingDeletionAt={pendingDeletionAt} />
			) : (
				<UnverifiedOrgBanner />
			)}
			<AppHeading button={button} description={description} title={title} />

			<nav
				aria-label="Organization sections"
				className="mt-6 border-b border-border/70"
			>
				<ul className="-mb-px flex flex-wrap gap-x-6">
					{visibleTabs.map((tab) => {
						const isActive =
							tab.href === "/organizations"
								? currentPath === "/organizations"
								: currentPath === tab.href;

						return (
							<li key={tab.href}>
								<Link
									className={cn(
										"inline-flex items-center border-b-2 px-1 py-3 font-medium text-sm transition-colors",
										isActive
											? "border-foreground text-foreground"
											: "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
									)}
									to={tab.href}
								>
									{tab.label}
								</Link>
							</li>
						);
					})}
				</ul>
			</nav>

			<div className="mt-8 flex-1">{children}</div>
		</div>
	);
}
