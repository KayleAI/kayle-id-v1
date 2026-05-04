import { createFileRoute } from "@tanstack/react-router";
import { AccountSettingsPage } from "@/app/account/settings";

export const Route = createFileRoute("/_app/account/settings")({
	component: AccountSettingsPage,
});
