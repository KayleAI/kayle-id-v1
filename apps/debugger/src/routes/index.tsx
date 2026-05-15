import { createFileRoute, redirect } from "@tanstack/react-router";

// Root URL has nothing to show on its own — redirect to the first
// debug surface. If a future section becomes the more common entry
// point, swap the target here.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/biometric/full-pipeline" });
	},
});
