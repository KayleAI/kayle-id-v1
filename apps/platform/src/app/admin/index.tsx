import { useAuth } from "@kayle-id/auth/client/provider";
import { Card, CardContent } from "@kayleai/ui/card";
import { Navigate } from "@tanstack/react-router";
import { ShieldCheckIcon } from "lucide-react";
import { AppHeading } from "@/components/app-shell/heading";

export function AdminPage() {
	const { isPlatformAdmin, status } = useAuth();

	if (status === "loading") {
		return null;
	}

	if (!isPlatformAdmin) {
		return <Navigate to="/dashboard" />;
	}

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading title="Administrative Tools" />

			<div className="mt-8 flex-1">
				<Card>
					<CardContent className="flex flex-col items-center gap-3 py-16 text-center">
						<ShieldCheckIcon className="size-10 text-muted-foreground" />
						<h2 className="font-medium text-lg">No tools yet</h2>
						<p className="max-w-md text-muted-foreground text-sm">
							Approval queues and other admin tooling will appear here as
							they're built.
						</p>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
