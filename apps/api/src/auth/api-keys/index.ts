import { OpenAPIHono } from "@hono/zod-openapi";
import { denyFrozenOrgWrites, sessionMiddleware } from "@/v1/auth";
import { createApiKeyRoute } from "./create";
import { deleteApiKeyRoute } from "./delete";
import { listApiKeys } from "./list";
import { updateApiKeyRoute } from "./update";

const apiKeys = new OpenAPIHono<{ Bindings: CloudflareBindings }>();

apiKeys.use(sessionMiddleware);
apiKeys.use(denyFrozenOrgWrites());

apiKeys.route("/", listApiKeys);
apiKeys.route("/", createApiKeyRoute);
apiKeys.route("/", updateApiKeyRoute);
apiKeys.route("/", deleteApiKeyRoute);

export default apiKeys;
