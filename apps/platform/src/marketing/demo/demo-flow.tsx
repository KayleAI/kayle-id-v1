import { Button } from "@kayleai/ui/button";
import type { ReactNode } from "react";
import { demoStepOrder, getDemoStepNumber } from "@/marketing/demo/constants";
import type { DemoStepId } from "@/marketing/demo-hooks";

export function DemoFlow({
	children,
	onChangeDetails,
	stepId,
}: {
	children: ReactNode;
	onChangeDetails: () => void;
	stepId: DemoStepId;
}) {
	const stepNumber = getDemoStepNumber(stepId);

	return (
		<section className="mx-auto max-w-2xl" id="demo-flow">
			<div className="flex items-center justify-between gap-4 border-border/70 border-b pb-4">
				<p className="font-medium text-muted-foreground text-sm tabular-nums">
					Step {stepNumber} of {demoStepOrder.length}
				</p>
				<div className="min-w-30 text-right">
					{stepId === "step-1" ? (
						<div className="h-[32px]" />
					) : (
						<Button
							onClick={onChangeDetails}
							size="sm"
							type="button"
							variant="outline"
						>
							Restart demo
						</Button>
					)}
				</div>
			</div>
			<div className="min-h-52 py-6">{children}</div>
		</section>
	);
}
