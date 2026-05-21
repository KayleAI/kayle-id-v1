import { useAuth } from "@kayle-id/auth/client/provider";
import { Layout } from "@kayle-id/ui/components/layout";
import { Toaster } from "@kayle-id/ui/components/sonner";
import { TooltipProvider } from "@kayle-id/ui/components/tooltip";
import { InfoCard } from "@kayle-id/ui/info-card";
import {
	createFileRoute,
	type ErrorComponentProps,
	Navigate,
} from "@tanstack/react-router";
import { OnboardingPage } from "@/app/onboarding/page";
import { Loading } from "@/components/loading";
import { NotFound } from "@/components/not-found";
import { getErrorMessage } from "@/utils/get-error-message";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingRoute,
	notFoundComponent: NotFound,
	errorComponent: OnboardingErrorView,
});

function OnboardingErrorView({ error }: ErrorComponentProps) {
	const description = getErrorMessage(error, "An unexpected error occurred.");
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
		return <Navigate to="/select-organization" />;
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
