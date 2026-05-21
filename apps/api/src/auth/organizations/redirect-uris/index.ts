import { OpenAPIHono } from "@hono/zod-openapi";
import { addRedirectUriHandler } from "./add";
import { listRedirectUrisHandler } from "./list";
import {
	addRedirectUriRoute,
	listRedirectUrisRoute,
	removeRedirectUriRoute,
} from "./openapi";
import { removeRedirectUriHandler } from "./remove";
import type { RedirectUrisEnv } from "./types";

const redirectUris = new OpenAPIHono<RedirectUrisEnv>();

redirectUris.openapi(listRedirectUrisRoute, listRedirectUrisHandler);
redirectUris.openapi(addRedirectUriRoute, addRedirectUriHandler);
redirectUris.openapi(removeRedirectUriRoute, removeRedirectUriHandler);

export { redirectUris };
