import type { OnboardingStepId } from "@kayle-id/auth/organization-onboarding";
import { cn } from "@kayleai/ui/utils/cn";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2Icon } from "lucide-react";
import {
	type OnboardingRouteStep,
	pathForStep,
	useOnboardingContext,
} from "@/app/onboarding/shell-context";
import { useOnboardingStatus } from "@/app/onboarding/use-onboarding-status";

export const Route = createFileRoute("/onboarding/")({
	component: OnboardingIntroStep,
});

const INTRO_STEPS: readonly {
	description: string;
	id: OnboardingStepId;
	route: OnboardingRouteStep;
	title: string;
}[] = [
	{
		id: "public",
		route: "public",
		title: "Public details",
		description:
			"The logo, website, description, and legal links shown to users during the verify flow.",
	},
	{
		id: "business",
		route: "business",
		title: "Business details",
		description:
			"The registered legal entity (or individual) behind your organization.",
	},
	{
		id: "compliance",
		route: "compliance",
		title: "Compliance",
		description:
			"Lawful basis, decision purpose, support contacts, and the current Kayle ID Integration Terms.",
	},
	{
		id: "owner_id",
		route: "owner-id",
		title: "Owner identity check",
		description:
			"As the final step, an owner completes a one-time Kayle ID identity check.",
	},
];

function OnboardingIntroStep() {
	const { organization } = useOnboardingContext();
	const navigate = useNavigate();
	const { steps } = useOnboardingStatus();
	const completeById = new Map<OnboardingStepId, boolean>(
		steps.map((s) => [s.id, s.complete]),
	);

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl text-foreground tracking-tight">
					Welcome to Kayle ID
				</h1>
				<p className="text-muted-foreground text-sm">
					Let's get{" "}
					<span className="font-medium text-foreground">
						{organization.name}
					</span>{" "}
					set up so you can start running identity checks. We'll walk through
					four short steps — it should take under five minutes.
				</p>
			</div>

			<ol className="space-y-3">
				{INTRO_STEPS.map((step, index) => {
					const complete = completeById.get(step.id) === true;
					return (
						<li key={step.id}>
							<button
								className={cn(
									"flex w-full items-start gap-3 rounded-xl border bg-card/40 px-4 py-3 text-left transition",
									"hover:border-foreground/30 hover:bg-muted/60",
									"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
									complete
										? "border-emerald-500/40 dark:border-emerald-500/30"
										: "border-border",
								)}
								onClick={() => navigate({ to: pathForStep(step.route) })}
								type="button"
							>
								{complete ? (
									<CheckCircle2Icon
										aria-hidden="true"
										className="mt-0.5 size-6 shrink-0 text-emerald-500 dark:text-emerald-400"
									/>
								) : (
									<span
										aria-hidden="true"
										className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background font-semibold text-foreground text-xs"
									>
										{index + 1}
									</span>
								)}
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2">
										<p className="font-medium text-foreground text-sm">
											{step.title}
										</p>
										<span
											className={cn(
												"rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
												complete
													? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
													: "bg-muted text-muted-foreground",
											)}
										>
											{complete ? "Complete" : "Incomplete"}
										</span>
									</div>
									<p className="mt-0.5 text-muted-foreground text-sm">
										{step.description}
									</p>
								</div>
							</button>
						</li>
					);
				})}
			</ol>
		</div>
	);
}
