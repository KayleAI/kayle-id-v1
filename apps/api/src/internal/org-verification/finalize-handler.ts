import { OpenAPIHono } from "@hono/zod-openapi";
import { finalizeOrgVerificationRoute } from "./finalize-route";
import { finalizeOrgVerificationHandler } from "./finalize-route-handler";

const finalize = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

finalize.openapi(finalizeOrgVerificationRoute, finalizeOrgVerificationHandler);

export default finalize;
