export const EXPIRED_SESSION_NORMALIZATION_BATCH_SIZE = 100;
export const EXPIRED_SESSION_NORMALIZATION_MAX_BATCHES = 10;

export const SESSION_PRIVACY_MINIMIZATION_VALUES = {
	claimedAt: null,
	claimedByConnectionId: null,
	currentPhase: null,
	mobileAttestKeyId: null,
	mobileHelloAppVersion: null,
	mobileHelloDeviceIdHash: null,
	mobileWriteTokenConsumedAt: null,
	mobileWriteTokenExpiresAt: null,
	mobileWriteTokenHash: null,
	mobileWriteTokenIssuedAt: null,
	mobileWriteTokenSeed: null,
	phaseUpdatedAt: null,
	riskScore: 0,
	selectedShareFieldKeys: [] as string[],
};
