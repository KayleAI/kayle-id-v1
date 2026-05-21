export type MembersAppEnv = {
	Bindings: CloudflareBindings;
	Variables: { organizationId?: string | null; userId?: string };
};

export interface MemberActor {
	organizationId: string;
	userId: string;
}
