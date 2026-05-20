import { useAuth } from "@kayle-id/auth/client/provider";
import { Card, CardContent } from "@kayle-id/ui/components/card";
import { Link, Navigate } from "@tanstack/react-router";
import { ChartBarIcon, FlagIcon } from "lucide-react";
import { AppHeading } from "@/components/app-shell/heading";

const ADMIN_TOOLS: ReadonlyArray<{
	to: string;
	title: string;
	description: string;
	Icon: typeof ChartBarIcon;
}> = [
	{
		to: "/admin/cost-analytics",
		title: "Cost analytics",
		description:
			"Estimated Cloudflare spend by feature, resource, day, and organization.",
		Icon: ChartBarIcon,
	},
	{
		to: "/admin/organization-reports",
		title: "Organization reports",
		description:
			"Review reports submitted against organizations using Kayle ID.",
		Icon: FlagIcon,
	},
];

export function AdminPage() {
	const { isPlatformAdmin, status } = useAuth();

	if (status === "loading") {
		return null;
	}

	if (!isPlatformAdmin) {
		return <Navigate to="/dashboard" />;
	}

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-1 grow flex-col">
			<AppHeading title="Administrative Tools" />

			<div className="mt-8 grid flex-1 gap-4 sm:grid-cols-2">
				{ADMIN_TOOLS.map(({ to, title, description, Icon }) => (
					<Link className="block" key={to} to={to}>
						<Card className="transition-colors hover:border-emerald-500/40">
							<CardContent className="flex flex-col gap-3 p-6">
								<Icon className="size-6 text-emerald-400" />
								<h2 className="font-medium text-lg">{title}</h2>
								<p className="text-muted-foreground text-sm">{description}</p>
							</CardContent>
						</Card>
					</Link>
				))}
			</div>
		</div>
	);
}
