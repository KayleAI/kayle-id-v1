export type VerificationSession = {
	id: string;
	organizationId: string;
	status: "created" | "in_progress" | "completed" | "expired" | "cancelled";
	redirectUrl: string | null;
	expiresAt: Date;
	completedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};
