import type { OrganizationRole } from "@kayle-id/auth/types";
import { cn } from "@kayle-id/ui/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import { useCurrentMemberRole } from "./use-organization-query";

interface TabDefinition {
	href:
		| "/settings/organizations"
		| "/settings/organizations/members"
		| "/settings/organizations/settings"
		| "/settings/organizations/public"
		| "/settings/organizations/business"
		| "/settings/organizations/compliance"
		| "/settings/organizations/domains";
	label: string;
	requiresRole?: "admin";
}

const TABS: readonly TabDefinition[] = [
	{ href: "/settings/organizations", label: "Overview" },
	{ href: "/settings/organizations/members", label: "Members" },
	{ href: "/settings/organizations/public", label: "Public details" },
	{ href: "/settings/organizations/compliance", label: "Compliance" },
	{ href: "/settings/organizations/business", label: "Business" },
	{ href: "/settings/organizations/domains", label: "Domains" },
	{ href: "/settings/organizations/settings", label: "Settings" },
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
	const currentRole = useCurrentMemberRole();
	const visibleTabs = TABS.filter((tab) =>
		roleSatisfies(currentRole, tab.requiresRole),
	);

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading button={button} description={description} title={title} />

			<nav
				aria-label="Organization sections"
				className="mt-6 border-b border-border/70"
			>
				<ul className="-mb-px flex flex-wrap gap-x-6">
					{visibleTabs.map((tab) => {
						const isActive =
							tab.href === "/settings/organizations"
								? currentPath === "/settings/organizations"
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
