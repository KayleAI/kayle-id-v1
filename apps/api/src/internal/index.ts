import { OpenAPIHono } from "@hono/zod-openapi";
import checkMembership from "./auth/check-membership";
import { requireInternalTrustToken } from "./middleware";
import finalize from "./org-verification/finalize-handler";

const internal = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

internal.use(requireInternalTrustToken);

internal.route("/auth", checkMembership);
internal.route("/org-verification", finalize);

export default internal;
