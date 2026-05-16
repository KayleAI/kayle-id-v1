import type { DemoRunView } from "@/demo/types";
import { DemoStepPanel } from "@/marketing/demo/demo-step-panel";
import { RunStatusPanel } from "@/marketing/demo/run-status-panel";

export function DemoVerificationStep({
	hasSession,
	run,
}: {
	hasSession: boolean;
	run: DemoRunView | null;
}) {
	return (
		<DemoStepPanel isLocked={!hasSession} stepId="step-2">
			<RunStatusPanel run={run} />
		</DemoStepPanel>
	);
}
