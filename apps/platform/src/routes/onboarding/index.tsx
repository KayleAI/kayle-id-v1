import { createFileRoute } from "@tanstack/react-router";
import { useOnboardingContext } from "@/app/onboarding/shell-context";

export const Route = createFileRoute("/onboarding/")({
	component: OnboardingIntroStep,
});

const INTRO_STEPS: readonly { title: string; description: string }[] = [
	{
		title: "Public details",
		description:
			"The logo, website, description, and legal links shown to users during the verify flow.",
	},
	{
		title: "Business details",
		description:
			"The registered legal entity (or individual) behind your organization.",
	},
	{
		title: "Compliance",
		description:
			"Lawful basis, decision purpose, support contacts, and the current Kayle ID Integration Terms.",
	},
	{
		title: "Owner identity check",
		description:
			"As the final step, an owner completes a one-time Kayle ID identity check.",
	},
];

function OnboardingIntroStep() {
	const { organization } = useOnboardingContext();

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
				{INTRO_STEPS.map((step, index) => (
					<li
						className="flex items-start gap-3 rounded-xl border border-border bg-card/40 px-4 py-3"
						key={step.title}
					>
						<span
							aria-hidden="true"
							className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background font-semibold text-foreground text-xs"
						>
							{index + 1}
						</span>
						<div className="min-w-0 flex-1">
							<p className="font-medium text-foreground text-sm">
								{step.title}
							</p>
							<p className="mt-0.5 text-muted-foreground text-sm">
								{step.description}
							</p>
						</div>
					</li>
				))}
			</ol>
		</div>
	);
}
