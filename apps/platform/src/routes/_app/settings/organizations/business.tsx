import { createFileRoute } from "@tanstack/react-router";
import { OrganizationBusinessPage } from "@/app/organizations/business";

export const Route = createFileRoute("/_app/settings/organizations/business")({
	component: OrganizationBusinessPage,
});
