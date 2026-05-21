import type { buildRequestedShareFields } from "@/demo/claim-fields";
import type { DemoFieldMode } from "@/demo/types";

export interface DemoCopy {
	description: string;
	title: string;
}

export type SelectionResult = ReturnType<typeof buildRequestedShareFields>;

export interface DemoComposerProps {
	ageThresholdText: string;
	fieldModes: Record<string, DemoFieldMode>;
	hasSession: boolean;
	isCreatingRun: boolean;
	isCreatingSession: boolean;
	isRestartingDemo: boolean;
	onAgeThresholdChange: (value: string) => void;
	onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
	onCreateSession: () => void;
	onRestartDemo: () => void;
	runId: string | null;
	selectionResult: SelectionResult;
}
