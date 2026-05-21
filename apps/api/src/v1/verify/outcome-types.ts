export type SessionContext = {
	contractVersion: number;
	id: string;
	organizationId: string;
	status: string;
	completedAt: Date | null;
};
