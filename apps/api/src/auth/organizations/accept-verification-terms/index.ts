import { OpenAPIHono } from "@hono/zod-openapi";
import { acceptVerificationTermsHandler } from "./handler";
import { acceptVerificationTermsRoute } from "./openapi";
import type { AcceptVerificationTermsEnv } from "./types";

const acceptVerificationTerms = new OpenAPIHono<AcceptVerificationTermsEnv>();

acceptVerificationTerms.openapi(
	acceptVerificationTermsRoute,
	acceptVerificationTermsHandler,
);

export { acceptVerificationTerms };
