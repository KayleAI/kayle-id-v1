import type { DemoStepId } from "@/marketing/demo-hooks";

export const DEFAULT_AGE_THRESHOLD = "18";

export const demoStepOrder: DemoStepId[] = ["step-1", "step-2", "step-3"];

export function getDemoStepNumber(stepId: DemoStepId): number {
	return demoStepOrder.indexOf(stepId) + 1;
}
