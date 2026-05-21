import type { Context } from "hono";

export type RedirectUrisEnv = {
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
};

export type RedirectUriContext = Context<RedirectUrisEnv>;

export interface ResolvedActor {
	organizationId: string;
	userId: string;
}
