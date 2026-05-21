import { OpenAPIHono } from "@hono/zod-openapi";
import { leaveOrganizationHandler } from "./leave-organization";
import {
	leaveOrganizationRoute,
	reinstateMemberRoute,
	suspendMemberRoute,
} from "./openapi";
import { reinstateMemberHandler } from "./reinstate-member";
import { suspendMemberHandler } from "./suspend-member";
import type { MembersAppEnv } from "./types";

const members = new OpenAPIHono<MembersAppEnv>();

members.openapi(suspendMemberRoute, suspendMemberHandler);
members.openapi(leaveOrganizationRoute, leaveOrganizationHandler);
members.openapi(reinstateMemberRoute, reinstateMemberHandler);

export { members };
