import { createFileRoute } from "@tanstack/react-router";
import { AccountSettingsPage } from "@/app/account/account-settings";

export const Route = createFileRoute("/_app/account/")({
	component: AccountSettingsPage,
});
