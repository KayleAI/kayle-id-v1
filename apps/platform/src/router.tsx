import { createRouter, type NotFoundRouteProps } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";
import { routeTree } from "./routeTree.gen";

function defaultNotFoundComponent(props: NotFoundRouteProps): React.ReactNode {
	return <NotFound {...props} />;
}

export const getRouter = () =>
	createRouter({
		routeTree,
		defaultNotFoundComponent,
		scrollRestoration: true,
		defaultPreloadStaleTime: 0,
		trailingSlash: "never",
	});
