export interface BetterAuthResult<T> {
	data: T | null;
	error: { code?: string; message?: string; status?: number } | null;
}

export function unwrapBetterAuthResult<T>(
	result: BetterAuthResult<T> | null | undefined,
	fallback: string,
): T {
	if (
		!result ||
		result.error ||
		result.data === null ||
		result.data === undefined
	) {
		throw new Error(result?.error?.message ?? fallback);
	}
	return result.data;
}
