import { Button } from "@kayle-id/ui/components/button";
import { Loader2Icon } from "lucide-react";
import type { SelectionResult } from "@/marketing/demo/types";

export function DemoComposerActions({
	hasSession,
	isCreatingRun,
	isCreatingSession,
	isRestartingDemo,
	onCreateSession,
	onRestartDemo,
	runId,
	selectionResult,
}: {
	hasSession: boolean;
	isCreatingRun: boolean;
	isCreatingSession: boolean;
	isRestartingDemo: boolean;
	onCreateSession: () => void;
	onRestartDemo: () => void;
	runId: string | null;
	selectionResult: SelectionResult;
}) {
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
			{hasSession || isRestartingDemo ? (
				<Button
					disabled={isCreatingSession || isCreatingRun}
					onClick={onRestartDemo}
					type="button"
				>
					{isCreatingSession || isCreatingRun ? (
						<Loader2Icon className="mr-2 size-4 animate-spin" />
					) : null}
					Restart demo
				</Button>
			) : (
				<Button
					disabled={
						isCreatingSession || isCreatingRun || !runId || !selectionResult.ok
					}
					onClick={onCreateSession}
					type="button"
				>
					{isCreatingSession ? (
						<Loader2Icon className="mr-2 size-4 animate-spin" />
					) : null}
					Create session
				</Button>
			)}
		</div>
	);
}
