import { minAgeThreshold } from "@kayle-id/config/share-claims";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import { cn } from "@kayle-id/ui/lib/utils";
import { DemoComposerActions } from "@/marketing/demo/composer-actions";
import { DEFAULT_AGE_THRESHOLD } from "@/marketing/demo/constants";
import { DemoNotice } from "@/marketing/demo/demo-notice";
import { DemoShell } from "@/marketing/demo/demo-shell";
import type { DemoComposerProps, DemoCopy } from "@/marketing/demo/types";
import { getDemoStepSectionId } from "@/marketing/demo-hooks";

const AGE_DEMO_COPY: DemoCopy = {
	title: "See how age verification works with a demo.",
	description:
		"Set an age requirement, complete the check, and see the pass/fail result Kayle returns without exposing the person's birth date.",
};

function AgeGateSelector({
	errorMessage,
	thresholdText,
	onChange,
}: {
	errorMessage?: string | null;
	thresholdText: string;
	onChange: (value: string) => void;
}) {
	const hasError = Boolean(errorMessage);

	return (
		<div>
			<div className="grid gap-5 border-border/70 border-b pb-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="min-w-0">
					<Label
						className="block font-light text-2xl text-foreground tracking-tight"
						htmlFor="age-threshold"
					>
						Check an age requirement
					</Label>
					<p className="mt-1 max-w-xl text-muted-foreground text-sm leading-relaxed">
						Kayle only returns whether the person meets the age you choose.
					</p>
				</div>
				<div className="relative w-full sm:w-28">
					<Input
						aria-describedby={hasError ? "age-threshold-error" : undefined}
						aria-invalid={hasError || undefined}
						className={cn(
							"h-12 w-full rounded-full pr-8 text-center font-medium text-lg shadow-none",
							hasError &&
								"border-red-200 ring-1 ring-red-200 dark:border-red-900/70 dark:ring-red-900/70",
						)}
						id="age-threshold"
						inputMode="numeric"
						min={minAgeThreshold}
						name="age"
						onChange={(event) => {
							onChange(event.target.value);
						}}
						placeholder={String(minAgeThreshold)}
						type="text"
						value={thresholdText}
					/>
					<span className="-translate-y-1/2 pointer-events-none absolute top-1/2 right-3.5 text-muted-foreground text-base">
						+
					</span>
				</div>
			</div>
			{errorMessage ? (
				<DemoNotice className="mt-4" title="Check the age">
					<span id="age-threshold-error">{errorMessage}</span>
				</DemoNotice>
			) : null}
		</div>
	);
}
function AgeDemoComposer({
	ageThresholdText,
	hasSession,
	isCreatingRun,
	isCreatingSession,
	isRestartingDemo,
	onAgeThresholdChange,
	onCreateSession,
	onRestartDemo,
	runId,
	selectionResult,
}: DemoComposerProps) {
	return (
		<section className="scroll-mt-24" id={getDemoStepSectionId("step-1")}>
			<div className="space-y-6">
				<AgeGateSelector
					errorMessage={selectionResult.ok ? null : selectionResult.message}
					onChange={onAgeThresholdChange}
					thresholdText={ageThresholdText}
				/>

				<DemoComposerActions
					hasSession={hasSession}
					isCreatingRun={isCreatingRun}
					isCreatingSession={isCreatingSession}
					isRestartingDemo={isRestartingDemo}
					onCreateSession={onCreateSession}
					onRestartDemo={onRestartDemo}
					runId={runId}
					selectionResult={selectionResult}
				/>
			</div>
		</section>
	);
}

export function AgeDemo() {
	return (
		<DemoShell
			Composer={AgeDemoComposer}
			copy={AGE_DEMO_COPY}
			initialAgeThresholdText={DEFAULT_AGE_THRESHOLD}
			outcomeMode="age"
		/>
	);
}
