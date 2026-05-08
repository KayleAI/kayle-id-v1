import { createFileRoute } from "@tanstack/react-router";
import { Demo } from "@/marketing/demo";

export const Route = createFileRoute("/_marketing/demo/age")({
	component: () => <Demo mode="age" />,
});
