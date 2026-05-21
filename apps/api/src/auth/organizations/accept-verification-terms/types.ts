import type { Context } from "hono";

export type AcceptVerificationTermsEnv = {
	Bindings: CloudflareBindings;
	Variables: { userId?: string };
};

export type AcceptVerificationTermsContext =
	Context<AcceptVerificationTermsEnv>;

export type AcceptedVerificationTerms = {
	verificationTermsAcceptedAt: Date;
	verificationTermsAcceptedBy: string;
};
