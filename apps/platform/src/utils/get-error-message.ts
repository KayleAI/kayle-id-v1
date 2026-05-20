export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.length > 0
		? error.message
		: fallback;
}
