import { runDocumentPhaseValidation } from "./socket-document-validation";
import { runLivenessPhaseValidation } from "./socket-liveness-validation";

export { shouldRejectSuccessfulFallbackMatch } from "./socket-liveness-validation";
export { buildMissingDataMessage } from "./socket-missing-data";

import type { VerifySocketContext } from "./socket-context";

export async function runPhaseValidation(
	context: VerifySocketContext,
	sessionId: string,
	nextPhase: "nfc_complete" | "liveness_complete",
) {
	return nextPhase === "nfc_complete"
		? runDocumentPhaseValidation({ context, sessionId })
		: runLivenessPhaseValidation({ context, sessionId });
}
