import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppHeading } from "@/components/app-shell/heading";
import { SectionNav } from "@/components/app-shell/section-nav";

const ACCOUNT_NAV_ITEMS = [
	{ exact: true, label: "My Account", to: "/account" },
	{ label: "Security", to: "/account/security" },
] as const;

export const Route = createFileRoute("/_app/account")({
	component: AccountLayoutRoute,
});

function AccountLayoutRoute() {
	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading
				description="Manage your profile, preferences, and security."
				title="Account"
			/>
			<div className="mt-8">
				<SectionNav items={[...ACCOUNT_NAV_ITEMS]} />
			</div>
			<div className="mt-8 flex flex-1 flex-col">
				<Outlet />
			</div>
		</div>
	);
}
