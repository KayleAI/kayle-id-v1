import { useAuth } from "@kayle-id/auth/client/provider";
import { cn } from "@kayleai/ui/utils/cn";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import { PendingDeletionBanner } from "./pending-deletion-banner";

interface TabDefinition {
	href:
		| "/organizations"
		| "/organizations/members"
		| "/organizations/settings"
		| "/organizations/public";
	label: string;
}

const TABS: readonly TabDefinition[] = [
	{ href: "/organizations", label: "Overview" },
	{ href: "/organizations/members", label: "Members" },
	{ href: "/organizations/public", label: "Public details" },
	{ href: "/organizations/settings", label: "Settings" },
] as const;

interface OrganizationPageLayoutProps {
	button?: ReactNode;
	children: ReactNode;
	description?: string;
	title: string;
}

export function OrganizationPageLayout({
	button,
	children,
	description,
	title,
}: OrganizationPageLayoutProps) {
	const { location } = useRouterState();
	const currentPath = location.pathname.replace(/\/$/, "");
	const { activeOrganization } = useAuth();
	const pendingDeletionAt = activeOrganization?.pendingDeletionAt ?? null;

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			{pendingDeletionAt ? (
				<PendingDeletionBanner pendingDeletionAt={pendingDeletionAt} />
			) : null}
			<AppHeading button={button} description={description} title={title} />

			<nav
				aria-label="Organization sections"
				className="mt-8 border-b border-border/70"
			>
				<ul className="-mb-px flex flex-wrap gap-x-6">
					{TABS.map((tab) => {
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
