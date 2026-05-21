export type { MarkCheckFailedResult } from "./outcome-check-failure";
export { markCheckFailed } from "./outcome-check-failure";
export { markSessionSucceeded } from "./outcome-success";
export { markSessionFailed } from "./outcome-terminal-failure";
export type { SessionContext } from "./outcome-types";
export type { CheckKind, NegativeFailureCode } from "./retry-limits";
export {
	failedCheckForCode,
	isHardKillCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
} from "./retry-limits";
