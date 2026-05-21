import type { Context } from "hono";

export type RpTermsEnv = {
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
};

export type RpTermsContext = Context<RpTermsEnv>;

export interface ResolvedActor {
	organizationId: string;
	userId: string;
}

export interface RpTermsAcceptanceRow {
	acceptedAt: Date;
	acceptedBy: string | null;
	jurisdiction: string;
	termsHash: string;
	termsVersion: string;
}
