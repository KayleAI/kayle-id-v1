import InfoCard from "@kayle-id/ui/info-card";
import { Button } from "@kayleai/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppHeading } from "@/components/app-shell/heading";
import { Loading } from "@/components/loading";
import { DeliveriesTabContent } from "@/components/webhooks/deliveries/tab";
import {
	EventAttachedEndpointsCard,
	EventOverviewCard,
} from "@/components/webhooks/events/detail-cards";
import { getErrorMessage } from "@/components/webhooks/shared";
import {
	listWebhookDeliveries,
	listWebhookEndpoints,
	listWebhookEvents,
	replayWebhookEvent,
	retryWebhookDelivery,
} from "./api";
import {
	getDeliveriesForEvent,
	getEndpointsById,
	getEventTriggerLabel,
} from "./utils";

export function WebhookEventPage({ eventId }: { eventId: string }) {
	const queryClient = useQueryClient();

	const eventsQuery = useQuery({
		queryKey: ["webhooks", "events"],
		queryFn: () =>
			listWebhookEvents({
				limit: 100,
			}),
	});

	const event =
		eventsQuery.data?.data.find((item) => item.id === eventId) ?? null;

	const endpointsQuery = useQuery({
		enabled: Boolean(event),
		queryKey: ["webhooks", "endpoints"],
		queryFn: () =>
			listWebhookEndpoints({
				limit: 100,
			}),
	});

	const deliveriesQuery = useQuery({
		enabled: Boolean(event),
		queryKey: ["webhooks", "deliveries"],
		queryFn: () =>
			listWebhookDeliveries({
				limit: 100,
			}),
	});

	const replayEventMutation = useMutation({
		mutationFn: replayWebhookEvent,
	});
	const retryDeliveryMutation = useMutation({
		mutationFn: retryWebhookDelivery,
	});

	const endpoints = endpointsQuery.data?.data ?? [];
	const endpointsById = getEndpointsById(endpoints);
	const eventDeliveries = event
		? getDeliveriesForEvent(deliveriesQuery.data?.data ?? [], event.id)
		: [];

	function refreshWebhookQueries(): Promise<void> {
		return queryClient.invalidateQueries({ queryKey: ["webhooks"] });
	}

	async function handleReplayEvent(targetEventId: string): Promise<void> {
		await replayEventMutation.mutateAsync(targetEventId);
		await refreshWebhookQueries();
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

			<div className="mt-3 flex flex-wrap items-center gap-3">
				<span className="text-muted-foreground text-sm">
					{getEventTriggerLabel(event)}
				</span>
				<span className="break-all font-mono text-muted-foreground text-xs">
					{event.id}
				</span>
			</div>

			<div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.55fr)]">
				<EventAttachedEndpointsCard
					endpointsById={endpointsById}
					error={endpointsQuery.error}
					event={event}
				/>
				<EventOverviewCard
					event={event}
					isReplaying={replayEventMutation.isPending}
					onReplayEvent={handleReplayEvent}
				/>
			</div>

			<div className="mt-8 space-y-3">
				<h2 className="font-medium text-sm">Delivery history</h2>
				<DeliveriesTabContent
					context="event"
					deliveries={eventDeliveries}
					endpointsById={endpointsById}
					error={deliveriesQuery.error}
					isLoading={deliveriesQuery.isLoading}
					isRetrying={retryDeliveryMutation.isPending}
					onRetryDelivery={handleRetryDelivery}
				/>
			</div>
		</div>
	);
}
