import InfoCard from "@kayle-id/ui/info-card";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ApiKeysTable, CreateApiKey } from "@/app/api-keys";
import { API_KEYS_QUERY_KEY, listApiKeys } from "@/app/api-keys/api";
import { AppHeading } from "@/components/app-shell/heading";
import { Loading } from "@/components/loading";

export const Route = createFileRoute("/_app/api-keys/")({
	component: ApiKeysLayout,
});

function ApiKeysLayout() {
	const { data, isLoading, error, isError } = useQuery({
		queryKey: API_KEYS_QUERY_KEY,
		queryFn: listApiKeys,
	});

	if (isLoading) {
		return (
			<div className="fixed inset-0">
				<Loading layout />
			</div>
		);
	}

	if (isError) {
		return (
			<InfoCard
				colour="red"
				header={{
					title: "Error",
					description: "Failed to load API keys",
				}}
				message={{
					title: error?.name || "Failed to load API keys",
					description: error?.message || "Failed to load API keys",
				}}
			/>
		);
	}

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading button={<CreateApiKey />} title="API Keys" />
			<hr className="my-8" />
			<ApiKeysTable apiKeys={data?.data ?? []} />
		</div>
	);
}
