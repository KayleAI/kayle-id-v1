import InfoCard from "@kayle-id/ui/info-card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { API_KEYS_QUERY_KEY, listApiKeys } from "@/app/api-keys/api";
import { ApiKeyComponent } from "@/app/api-keys/key";
import { Loading } from "@/components/loading";

export const Route = createFileRoute("/_app/api-keys/$key")({
	component: ApiKeyLayout,
});

function ApiKeyLayout() {
	const { key } = Route.useParams();
	const { data, isLoading, error, isError } = useQuery({
		queryKey: API_KEYS_QUERY_KEY,
		queryFn: listApiKeys,
	});

	if (isLoading) {
		return <Loading />;
	}

	if (isError) {
		return (
			<InfoCard
				buttons={{
					primary: {
						label: "Go back",
						href: "/api-keys",
					},
				}}
				colour="red"
				header={{
					title: "Error",
					description: "Failed to load API key",
				}}
				message={{
					title: error?.name || "Failed to load API key",
					description: error?.message || "Failed to load API key",
				}}
			/>
		);
	}

	const apiKey = data?.data?.find((k) => k.id === key);

	if (!apiKey) {
		return (
			<InfoCard
				buttons={{
					primary: {
						label: "Go back",
						href: "/api-keys",
					},
				}}
				colour="red"
				header={{
					title: "Not Found",
					description: "API key not found",
				}}
				message={{
					title: "API key not found",
					description:
						"The API key you're looking for doesn't exist or has been deleted.",
				}}
			/>
		);
	}

	return <ApiKeyComponent apiKey={apiKey} />;
}
