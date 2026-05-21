import { OpenAPIHono } from "@hono/zod-openapi";
import { acceptRpTermsHandler, getRpTermsHandler } from "./handlers";
import { acceptRpTermsRoute, getRpTermsRoute } from "./openapi";
import type { RpTermsEnv } from "./types";

const rpTerms = new OpenAPIHono<RpTermsEnv>();

rpTerms.openapi(getRpTermsRoute, getRpTermsHandler);
rpTerms.openapi(acceptRpTermsRoute, acceptRpTermsHandler);

export { rpTerms };
