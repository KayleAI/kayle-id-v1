export type DomainsAppEnv = {
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
};

export type DomainActor = {
	organizationId: string;
	userId: string;
};
