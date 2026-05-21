import { createFileRoute } from "@tanstack/react-router";
import { AgeDemo } from "@/marketing/demo/age-demo";

export const Route = createFileRoute("/_marketing/demo/age")({
	component: AgeDemo,
});
