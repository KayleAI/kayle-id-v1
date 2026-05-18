import { useAuth } from "@kayle-id/auth/client/provider";
import { InfoCard } from "@kayle-id/ui/info-card";
import { Layout } from "@kayleai/ui/layout";
import { Toaster } from "@kayleai/ui/sonner";
import { TooltipProvider } from "@kayleai/ui/tooltip";
import {
	createFileRoute,
	type ErrorComponentProps,
	Navigate,
} from "@tanstack/react-router";
import { OnboardingPage } from "@/app/onboarding/page";
import { Loading } from "@/components/loading";
import { NotFound } from "@/components/not-found";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingRoute,
	// When a child route fails to match or throws, render the full-screen
	// NotFound / Error views in place of the onboarding shell rather than
	// inside the floating card's Outlet.
	notFoundComponent: NotFound,
	errorComponent: OnboardingErrorView,
});

function OnboardingErrorView({ error }: ErrorComponentProps) {
	const description =
		error instanceof Error ? error.message : "An unexpected error occurred.";
	return (
		<Layout>
			<InfoCard
				buttons={{
					primary: {
						label: "Go back",
						onClick: () => window.history.back(),
					},
					secondary: {
						label: "Go to dashboard",
						href: "/dashboard",
					},
				}}
				colour="red"
				footer={false}
				header={{
					title: "Something went wrong",
					description: "Onboarding hit an unexpected error.",
				}}
				message={{
					title: "We couldn't load this page",
					description,
				}}
			/>
		</Layout>
	);
}

function OnboardingRoute() {
	const { activeOrganization, status } = useAuth();

	if (status === "loading") {
		return <Loading fullscreen />;
	}
	if (status === "unauthenticated") {
		return <Navigate search={{ email: undefined }} to="/sign-in" />;
	}
	if (!activeOrganization) {
		return <Navigate to="/organizations/select" />;
	}

	// Onboarding "page" surface: solid white in light mode, solid black in
	// dark mode, with a soft drop shadow + rounded corners on lg+. The
	// floating aside and the preview card both layer on top of this surface
	// using `bg-card` (gray in both themes) so the cards read clearly against
	// the high-contrast page background.
	//
	// `notCenter` disables Layout's `items-center justify-center` so the
	// two-pane shell stretches horizontally; `p-0` strips Layout's internal
	// padding so the two panes fill the surface edge to edge.
	return (
		<TooltipProvider delay={150}>
			<Layout className={ONBOARDING_LAYOUT_CLASS_NAME} notCenter>
				<OnboardingPage />
				<Toaster />
			</Layout>
		</TooltipProvider>
	);
}

const ONBOARDING_LAYOUT_CLASS_NAME = [
	"p-0 lg:p-0",
	"lg:rounded-[1.75rem]! lg:bg-white!",
	"lg:shadow-[0_24px_80px_-48px_rgba(15,23,42,0.16)]!",
	"dark:lg:bg-black!",
	"dark:lg:shadow-[0_24px_80px_-48px_rgba(0,0,0,0.6)]!",
].join(" ");
