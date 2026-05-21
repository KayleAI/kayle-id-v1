import type { OrganizationRole } from "@kayle-id/auth/types";
import {
	NativeSelect,
	NativeSelectOption,
} from "@kayle-id/ui/components/native-select";
import { cn } from "@kayle-id/ui/lib/utils";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ChangeEvent, ReactNode } from "react";
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

function isTabActive(tab: TabDefinition, currentPath: string): boolean {
	return tab.href === "/settings/organizations"
		? currentPath === "/settings/organizations"
		: currentPath === tab.href;
}

export function OrganizationPageLayout({
	button,
	children,
	title,
}: OrganizationPageLayoutProps) {
	const { location } = useRouterState();
	const navigate = useNavigate();
	const currentPath = location.pathname.replace(/\/$/, "");
	const currentRole = useCurrentMemberRole();
	const visibleTabs = TABS.filter((tab) =>
		roleSatisfies(currentRole, tab.requiresRole),
	);
	const activeTabHref =
		visibleTabs.find((tab) => isTabActive(tab, currentPath))?.href ??
		visibleTabs[0]?.href ??
		"/settings/organizations";

	const handleSectionChange = (event: ChangeEvent<HTMLSelectElement>) => {
		const nextTab = visibleTabs.find(
			(tab) => tab.href === event.currentTarget.value,
		);

		if (!nextTab || nextTab.href === activeTabHref) {
			return;
		}

		navigate({ to: nextTab.href });
	};

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading button={button} title={title} />

			<div className="mt-4 md:hidden">
				<label className="sr-only" htmlFor="organization-section">
					Organization section
				</label>
				<NativeSelect
					aria-label="Organization section"
					className="w-full"
					id="organization-section"
					onChange={handleSectionChange}
					value={activeTabHref}
				>
					{visibleTabs.map((tab) => (
						<NativeSelectOption key={tab.href} value={tab.href}>
							{tab.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			</div>

			<nav
				aria-label="Organization sections"
				className="mt-6 hidden border-b border-border/70 md:block"
			>
				<ul className="-mb-px flex flex-wrap gap-x-6">
					{visibleTabs.map((tab) => {
						const isActive = isTabActive(tab, currentPath);

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

			<div className="mt-6 flex-1">{children}</div>
		</div>
	);
}
