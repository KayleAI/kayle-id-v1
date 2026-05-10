import { createFileRoute } from "@tanstack/react-router";
import { OrganizationBusinessPage } from "@/app/organizations/business";

export const Route = createFileRoute("/_app/organizations/business")({
	component: OrganizationBusinessPage,
});
