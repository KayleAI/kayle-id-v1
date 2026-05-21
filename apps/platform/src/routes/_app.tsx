import { useAuth } from "@kayle-id/auth/client/provider";
import { Toaster } from "@kayle-id/ui/components/sonner";
import { TooltipProvider } from "@kayle-id/ui/components/tooltip";
import { createFileRoute, Navigate, Outlet } from "@tanstack/react-router";
import { AppLayout } from "@/components/app-shell/layout";
import { Loading } from "@/components/loading";

export const Route = createFileRoute("/_app")({
	component: AppLayoutRoute,
});

function AppLayoutRoute() {
	const { status, activeOrganization } = useAuth();

	if (status === "loading") {
		return <Loading fullscreen />;
	}

	if (status === "unauthenticated") {
		return <Navigate search={{ email: undefined }} to="/sign-in" />;
	}

	if (!activeOrganization) {
		return <Navigate to="/select-organization" />;
	}

	return (
		<TooltipProvider delay={150}>
			<AppLayout>
				<Outlet />
				<Toaster />
			</AppLayout>
		</TooltipProvider>
	);
}
