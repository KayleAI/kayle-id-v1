import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "@/app/admin";

export const Route = createFileRoute("/_app/admin/")({
	component: AdminPage,
});
