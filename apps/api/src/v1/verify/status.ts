export const ACTIVE_SESSION_STATUSES = ["created", "in_progress"] as const;

const TERMINAL_SESSION_STATUSES = new Set([
	"succeeded",
	"failed",
	"expired",
	"cancelled",
]);

export function isTerminalSessionStatus(status: string): boolean {
	return TERMINAL_SESSION_STATUSES.has(status);
}
