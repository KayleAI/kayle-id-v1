import { Tabs, TabsContent } from "@kayleai/ui/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	const activeTab = activeTabProp ?? internalActiveTab;

	const endpointsQuery = useQuery({
		queryKey: ["webhooks", "endpoints"],
		queryFn: () =>
			listWebhookEndpoints({
				limit: 50,
			}),
	});

	const endpoints = endpointsQuery.data?.data ?? [];

	const eventsQuery = useQuery({
		queryKey: ["webhooks", "events"],
		queryFn: () =>
			listWebhookEvents({
				limit: 50,
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

	const events = eventsQuery.data?.data ?? [];
	const deliveries = deliveriesQuery.data?.data ?? [];
	const endpointDeliveryStats = getEndpointDeliveryStats(deliveries);

	function refreshWebhookQueries(): Promise<void> {
		return queryClient.invalidateQueries({ queryKey: ["webhooks"] });
	}

	function handleActiveTabChange(nextTab: WebhooksTab): void {
		setInternalActiveTab(nextTab);
		onActiveTabChange?.(nextTab);
	}

	async function handleCreateEndpoint(
		input: CreateEndpointSubmission,
	): Promise<CreateEndpointSubmissionResult> {
		const result = await createEndpointMutation.mutateAsync({
			enabled: input.enabled,
			environment: input.environment,
			name: input.name,
			subscribedEventTypes: input.subscribedEventTypes,
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
			name: endpoint.name,
			subscribedEventTypes: endpoint.subscribed_event_types,
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
		return (
			<div className="fixed inset-0">
				<Loading layout />
			</div>
		);
	}

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col">
			<AppHeading
				button={<CreateEndpointDrawer onSubmit={handleCreateEndpoint} />}
				title="Webhooks"
			/>

			<Tabs
				className="mt-6 gap-5"
				onValueChange={(value) => handleActiveTabChange(value as WebhooksTab)}
				value={activeTab}
			>
				<WebhooksToolbar />

				<TabsContent value="endpoints">
					<EndpointsTabContent
						deliveryStatsByEndpoint={endpointDeliveryStats}
						endpointError={endpointsQuery.error}
						endpoints={endpoints}
						isMutatingEndpointId={mutatingEndpointId}
						onDeleteEndpoint={handleDeleteEndpoint}
						onToggleEndpointEnabled={handleToggleEndpointEnabled}
					/>
				</TabsContent>

				<TabsContent value="events">
					<EventsTabContent
						error={eventsQuery.error}
						events={events}
						isLoading={eventsQuery.isLoading}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
