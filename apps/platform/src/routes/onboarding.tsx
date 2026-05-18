import { useAuth } from "@kayle-id/auth/client/provider";
import { Layout } from "@kayleai/ui/layout";
import { Toaster } from "@kayleai/ui/sonner";
import { TooltipProvider } from "@kayleai/ui/tooltip";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { OnboardingPage } from "@/app/onboarding/page";
import { Loading } from "@/components/loading";

export const Route = createFileRoute("/onboarding")({
	component: OnboardingRoute,
});

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

	// Match the verify app's layout: same rounded / frosted-glass / soft-shadow
	// chrome on `lg+`. `notCenter` disables Layout's `items-center
	// justify-center` so the two-pane shell stretches horizontally; `p-0`
	// strips Layout's internal padding so section + aside fill the card edge
	// to edge (the aside owns its own internal padding via header/body/footer).
	return (
		<TooltipProvider delay={150}>
			<Layout className={ONBOARDING_LAYOUT_CLASS_NAME} notCenter>
				<OnboardingPage />
				<Toaster />
			</Layout>
		</TooltipProvider>
	);
}

// Mirrors `VERIFY_LAYOUT_CLASS_NAME` in `apps/verify/src/app/verification.tsx`
// so the onboarding screen feels visually consistent with the verify flow
// users will see next.
const ONBOARDING_LAYOUT_CLASS_NAME = [
	"p-0 lg:p-0",
	"lg:rounded-[1.75rem]! lg:border-neutral-200/80! lg:bg-white/94!",
	"lg:shadow-[0_24px_80px_-48px_rgba(15,23,42,0.16)]! lg:backdrop-blur-xl!",
	"dark:lg:border-neutral-800/80! dark:lg:bg-neutral-900/94!",
	"dark:lg:shadow-[0_24px_80px_-48px_rgba(0,0,0,0.6)]!",
].join(" ");
