import { InfoCard } from "@kayle-id/ui/info-card";
import { Button } from "@kayleai/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppHeading } from "@/components/app-shell/heading";
import { Loading } from "@/components/loading";
import { RelativeTime } from "@/components/relative-time";
import { DeliveriesTabContent } from "@/components/webhooks/deliveries/tab";
import { getErrorMessage } from "@/components/webhooks/shared";
import {
	getWebhookEvent,
	listWebhookEndpoints,
	retryWebhookDelivery,
} from "./api";
import {
	formatCountLabel,
	getAttachedEndpointIds,
	getEndpointsById,
	getEventTriggerLabel,
} from "./utils";

export function WebhookEventPage({ eventId }: { eventId: string }) {
	const queryClient = useQueryClient();

	const eventsQuery = useQuery({
		queryKey: ["webhooks", "events", "detail", eventId],
		queryFn: () => getWebhookEvent(eventId),
	});

	const event = eventsQuery.data ?? null;

	const endpointsQuery = useQuery({
		enabled: Boolean(event),
		queryKey: ["webhooks", "endpoints"],
		queryFn: () =>
			listWebhookEndpoints({
				limit: 100,
			}),
	});

	const retryDeliveryMutation = useMutation({
		mutationFn: retryWebhookDelivery,
	});

	const endpoints = endpointsQuery.data?.data ?? [];
	const endpointsById = getEndpointsById(endpoints);

	function refreshWebhookQueries(): Promise<void> {
		return queryClient.invalidateQueries({ queryKey: ["webhooks"] });
	}

	async function handleRetryDelivery(deliveryId: string): Promise<void> {
		await retryDeliveryMutation.mutateAsync(deliveryId);
		await refreshWebhookQueries();
	}

	if (eventsQuery.isLoading && !eventsQuery.data) {
		return <Loading />;
	}

	if (eventsQuery.error) {
		return (
			<InfoCard
				buttons={{
					primary: {
						href: "/webhooks?tab=events",
						label: "Back to webhooks",
					},
				}}
				colour="red"
				footer={false}
				header={{
					title: "Error",
					description: "Failed to load webhook event",
				}}
				message={{
					title: "Webhook event unavailable",
					description: getErrorMessage(
						eventsQuery.error,
						"Failed to load webhook event.",
					),
				}}
			/>
		);
	}

	if (!event) {
		return (
			<InfoCard
				buttons={{
					primary: {
						href: "/webhooks?tab=events",
						label: "Back to webhooks",
					},
				}}
				colour="red"
				footer={false}
				header={{
					title: "Not Found",
					description: "Webhook event not found",
				}}
				message={{
					title: "Event not found",
					description:
						"The webhook event you're looking for doesn't exist or is no longer available.",
				}}
			/>
		);
	}

	const attachedEndpointCount = getAttachedEndpointIds(event).length;

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<div className="mb-4">
				<Button
					nativeButton={false}
					render={
						<Link search={{ tab: "events" }} to="/webhooks">
							Back to webhooks
						</Link>
					}
					size="sm"
					variant="outline"
				/>
			</div>

			<AppHeading title={event.type} />

			<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground text-sm">
				<span className="text-muted-foreground text-sm">
					{getEventTriggerLabel(event)}
				</span>
				<span className="tabular-nums">
					{formatCountLabel(attachedEndpointCount, "endpoint")}
				</span>
				<span className="tabular-nums">
					<RelativeTime iso={event.created_at} />
				</span>
			</div>

			<div className="mt-8 space-y-3">
				<h2 className="font-medium text-sm">Deliveries</h2>
				<DeliveriesTabContent
					context="event"
					deliveries={event.deliveries}
					endpointsById={endpointsById}
					error={endpointsQuery.error}
					isLoading={endpointsQuery.isLoading && endpoints.length === 0}
					isRetrying={retryDeliveryMutation.isPending}
					onRetryDelivery={handleRetryDelivery}
				/>
			</div>
		</div>
	);
}
