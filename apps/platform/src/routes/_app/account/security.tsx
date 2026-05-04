import { createFileRoute } from "@tanstack/react-router";
import { AccountSecurityPage } from "@/app/account/security";

export const Route = createFileRoute("/_app/account/security")({
	component: AccountSecurityPage,
});
