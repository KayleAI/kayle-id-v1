export type SessionsAppEnv = {
	Bindings: CloudflareBindings;
	Variables: {
		organizationId: string;
		type: "api" | "session";
	};
};
