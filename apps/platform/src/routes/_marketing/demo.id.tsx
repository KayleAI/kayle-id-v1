import { createFileRoute } from "@tanstack/react-router";
import { IdDemo } from "@/marketing/demo/id-demo";

export const Route = createFileRoute("/_marketing/demo/id")({
	component: IdDemo,
});
