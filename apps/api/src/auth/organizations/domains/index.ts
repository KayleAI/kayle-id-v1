import { OpenAPIHono } from "@hono/zod-openapi";
import { listDomainsHandler } from "./list-domains";
import {
	listDomainsRoute,
	removeDomainRoute,
	startDnsChallengeRoute,
	verifyDnsChallengeRoute,
} from "./openapi";
import { removeDomainHandler } from "./remove-domain";
import { startDnsChallengeHandler } from "./start-dns-challenge";
import type { DomainsAppEnv } from "./types";
import { verifyDnsChallengeHandler } from "./verify-dns-challenge";

const domains = new OpenAPIHono<DomainsAppEnv>();

domains.openapi(startDnsChallengeRoute, startDnsChallengeHandler);
domains.openapi(verifyDnsChallengeRoute, verifyDnsChallengeHandler);
domains.openapi(listDomainsRoute, listDomainsHandler);
domains.openapi(removeDomainRoute, removeDomainHandler);

export { domains };
