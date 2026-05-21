export function normalizeRiskScore(score: number): number {
	if (Number.isNaN(score)) {
		return 0;
	}

	return Math.max(0, Math.min(1, score));
}
