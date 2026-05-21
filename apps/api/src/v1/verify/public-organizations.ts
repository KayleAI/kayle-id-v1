import { Hono } from "hono";
import {
	getPublicOrganizationByIdentifier,
	searchPublicOrganizations,
} from "./public-organizations-repository";
import { registerPublicOrganizationRoutes } from "./public-organizations-routes";

const publicOrganizations = new Hono<{ Bindings: CloudflareBindings }>();

registerPublicOrganizationRoutes(publicOrganizations);

export { getPublicOrganizationByIdentifier, searchPublicOrganizations };

export default publicOrganizations;
