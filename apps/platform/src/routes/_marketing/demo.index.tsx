import { createFileRoute } from "@tanstack/react-router";
import { DemoChooser } from "@/marketing/demo-chooser";

export const Route = createFileRoute("/_marketing/demo/")({
	component: DemoChooser,
});
