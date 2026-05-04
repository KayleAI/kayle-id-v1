import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/app/account/profile";

export const Route = createFileRoute("/_app/account/")({
	component: ProfilePage,
});
