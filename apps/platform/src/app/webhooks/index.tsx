import { Tabs, TabsContent } from "@kayle-id/ui/components/tabs";
import {
	type InfiniteData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeading } from "@/components/app-shell/heading";
import { Loading } from "@/components/loading";
import { CreateEndpointDrawer } from "@/components/webhooks/endpoints/create-drawer";
import {
	EndpointsTabContent,
	WebhooksToolbar,
} from "@/components/webhooks/endpoints/list";
import { EventsTabContent } from "@/components/webhooks/events/tab";
import { getErrorMessage } from "@/components/webhooks/shared";
import {
	createWebhookEndpoint,
	createWebhookKey,
	deleteWebhookEndpoint,
	listWebhookDeliveries,
	listWebhookEndpoints,
	listWebhookEvents,
	updateWebhookEndpoint,
	type WebhookEndpoint,
} from "./api";
import {
	type CreateEndpointSubmission,
	type CreateEndpointSubmissionResult,
	getEndpointDeliveryStats,
	type WebhooksTab,
} from "./utils";

export { WebhookEndpointPage } from "./endpoint-detail-page";
export { WebhookEventPage } from "./event-detail-page";

const WEBHOOK_ENDPOINT_PAGE_SIZE = 20;
const WEBHOOK_EVENT_PAGE_SIZE = 20;

type WebhookEventPage = Awaited<ReturnType<typeof listWebhookEvents>>;

interface WebhooksPageProps {
	activeTab?: WebhooksTab;
	onActiveTabChange?: (tab: WebhooksTab) => void;
}

export function WebhooksPage({
	activeTab: activeTabProp,
	onActiveTabChange,
}: WebhooksPageProps = {}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [internalActiveTab, setInternalActiveTab] =
		useState<WebhooksTab>("endpoints");
	const [endpointPageIndex, setEndpointPageIndex] = useState(0);
	const [endpointPageCursors, setEndpointPageCursors] = useState<
		Array<string | null>
	>([null]);
	const activeTab = activeTabProp ?? internalActiveTab;
	const endpointStartingAfter = endpointPageCursors[endpointPageIndex] ?? null;

	const endpointsQuery = useQuery({
		placeholderData: (previousData) => previousData,
		queryKey: [
			"webhooks",
			"endpoints",
			{
				limit: WEBHOOK_ENDPOINT_PAGE_SIZE,
				startingAfter: endpointStartingAfter,
			},
		],
		queryFn: () =>
			listWebhookEndpoints({
				limit: WEBHOOK_ENDPOINT_PAGE_SIZE,
				startingAfter: endpointStartingAfter,
			}),
	});

	const endpoints = endpointsQuery.data?.data ?? [];

	const eventsQuery = useInfiniteQuery<
		WebhookEventPage,
		Error,
		InfiniteData<WebhookEventPage, string | null>,
		readonly unknown[],
		string | null
	>({
		getNextPageParam: (lastPage) =>
			lastPage.pagination.has_more ? lastPage.pagination.next_cursor : null,
		initialPageParam: null as string | null,
		queryKey: ["webhooks", "events", "list"],
		queryFn: ({ pageParam }) =>
			listWebhookEvents({
				limit: WEBHOOK_EVENT_PAGE_SIZE,
				startingAfter: pageParam,
			}),
	});

	const deliveriesQuery = useQuery({
		queryKey: ["webhooks", "deliveries"],
		queryFn: () =>
			listWebhookDeliveries({
				limit: 50,
			}),
	});

	const createEndpointMutation = useMutation({
		mutationFn: createWebhookEndpoint,
	});
	const createKeyMutation = useMutation({
		mutationFn: createWebhookKey,
	});
	const updateEndpointMutation = useMutation({
		mutationFn: updateWebhookEndpoint,
	});
	const deleteEndpointMutation = useMutation({
		mutationFn: deleteWebhookEndpoint,
	});

	const events = eventsQuery.data?.pages.flatMap((page) => page.data) ?? [];
	const deliveries = deliveriesQuery.data?.data ?? [];
	const endpointDeliveryStats = getEndpointDeliveryStats(deliveries);
	const hasNextEndpointPage = Boolean(
		endpointsQuery.data?.pagination.has_more &&
			endpointsQuery.data.pagination.next_cursor,
	);

	function refreshWebhookQueries(): Promise<void> {
		return queryClient.invalidateQueries({ queryKey: ["webhooks"] });
	}

	function handleActiveTabChange(nextTab: WebhooksTab): void {
		setInternalActiveTab(nextTab);
		onActiveTabChange?.(nextTab);
	}

	function handleNextEndpointPage(): void {
		const nextCursor = endpointsQuery.data?.pagination.next_cursor;
		if (!nextCursor) {
			return;
		}

		setEndpointPageCursors((currentValue) => [
			...currentValue.slice(0, endpointPageIndex + 1),
			nextCursor,
		]);
		setEndpointPageIndex((currentValue) => currentValue + 1);
	}

	function handlePreviousEndpointPage(): void {
		setEndpointPageIndex((currentValue) => Math.max(0, currentValue - 1));
	}

	async function handleCreateEndpoint(
		input: CreateEndpointSubmission,
	): Promise<CreateEndpointSubmissionResult> {
		const result = await createEndpointMutation.mutateAsync({
			enabled: input.enabled,
			labels: input.labels,
			name: input.name,
			subscribedEventTypes: input.subscribedEventTypes,
			undeliveredPayloadRetentionHours: input.undeliveredPayloadRetentionHours,
			url: input.url,
		});

		let publicKeyError: string | null = null;

		if (input.initialPublicKey) {
			try {
				await createKeyMutation.mutateAsync({
					endpointId: result.endpoint.id,
					jwk: input.initialPublicKey.jwk,
					keyId: input.initialPublicKey.keyId,
				});
			} catch (error) {
				publicKeyError = getErrorMessage(
					error,
					"The endpoint was created, but the public key could not be added.",
				);
			}
		}

		await refreshWebhookQueries();
		navigate({
			params: { endpoint: result.endpoint.id },
			to: "/webhooks/$endpoint",
		});

		return {
			publicKeyError,
		};
	}

	async function handleToggleEndpointEnabled(
		endpoint: WebhookEndpoint,
	): Promise<void> {
		await updateEndpointMutation.mutateAsync({
			endpointId: endpoint.id,
			enabled: !endpoint.enabled,
			labels: endpoint.labels,
			name: endpoint.name,
			subscribedEventTypes: endpoint.subscribed_event_types,
			undeliveredPayloadRetentionHours:
				endpoint.undelivered_payload_retention_hours,
			url: endpoint.url,
		});

		await refreshWebhookQueries();
	}

	async function handleDeleteEndpoint(
		endpoint: WebhookEndpoint,
	): Promise<void> {
		await deleteEndpointMutation.mutateAsync(endpoint.id);
		await refreshWebhookQueries();
	}

	let mutatingEndpointId: string | null = null;

	if (updateEndpointMutation.isPending) {
		mutatingEndpointId = updateEndpointMutation.variables?.endpointId ?? null;
	} else if (deleteEndpointMutation.isPending) {
		mutatingEndpointId = deleteEndpointMutation.variables;
	}

	if (endpointsQuery.isLoading && !endpointsQuery.data) {
		return <Loading />;
	}

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading
				button={<CreateEndpointDrawer onSubmit={handleCreateEndpoint} />}
				title="Webhooks"
			/>

			<Tabs
				className="mt-6 gap-5"
				onValueChange={(value) => handleActiveTabChange(value as WebhooksTab)}
				value={activeTab}
			>
				<WebhooksToolbar
					activeTab={activeTab}
					onActiveTabChange={handleActiveTabChange}
				/>

				<TabsContent value="endpoints">
					<EndpointsTabContent
						deliveryStatsByEndpoint={endpointDeliveryStats}
						endpointError={endpointsQuery.error}
						endpoints={endpoints}
						hasNextPage={hasNextEndpointPage}
						hasPreviousPage={endpointPageIndex > 0}
						isFetchingPage={endpointsQuery.isFetching}
						isMutatingEndpointId={mutatingEndpointId}
						onDeleteEndpoint={handleDeleteEndpoint}
						onNextPage={handleNextEndpointPage}
						onPreviousPage={handlePreviousEndpointPage}
						onToggleEndpointEnabled={handleToggleEndpointEnabled}
						pageLabel={`Page ${endpointPageIndex + 1}`}
					/>
				</TabsContent>

				<TabsContent value="events">
					<EventsTabContent
						error={eventsQuery.error}
						events={events}
						hasNextPage={eventsQuery.hasNextPage}
						isFetchingNextPage={eventsQuery.isFetchingNextPage}
						isLoading={eventsQuery.isLoading}
						onLoadMore={() => {
							void eventsQuery.fetchNextPage();
						}}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
