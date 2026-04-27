import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import InfoCard from "@kayle-id/ui/info-card";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayleai/ui/dropdown-menu";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@kayleai/ui/sheet";
import { Switch } from "@kayleai/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kayleai/ui/tabs";
import { Textarea } from "@kayleai/ui/textarea";
import { cn } from "@kayleai/ui/utils/cn";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	ChevronDownIcon,
	ChevronLeftIcon,
	CopyIcon,
	EllipsisVerticalIcon,
	EyeIcon,
	KeyRoundIcon,
	Loader2Icon,
	PauseIcon,
	PlayIcon,
	PlusIcon,
	RefreshCwIcon,
	ShieldAlertIcon,
	TrashIcon,
} from "lucide-react";
import { type ChangeEvent, type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppHeading } from "@/components/app-heading";
import { Loading } from "@/components/loading";
import { formatDate } from "@/utils/format-date";
import { useCopyToClipboard } from "@/utils/use-copy";
import {
	createWebhookEndpoint,
	createWebhookKey,
	deactivateWebhookKey,
	deleteWebhookEndpoint,
	listWebhookDeliveries,
	listWebhookEndpoints,
	listWebhookEvents,
	listWebhookKeys,
	parsePublicKeyInput,
	reactivateWebhookKey,
	replayWebhookEvent,
	retryWebhookDelivery,
	revealWebhookSigningSecret,
	rotateWebhookSigningSecret,
	updateWebhookEndpoint,
	type WebhookDelivery,
	type WebhookEncryptionKey,
	type WebhookEndpoint,
	type WebhookEvent,
} from "./api";
import { EditEndpointDrawer } from "./edit-endpoint-drawer";
import {
	EndpointDetailsPanel,
	EndpointKeysCard,
	EndpointPerformancePanel,
	EndpointResourcesCard,
	EndpointSigningSecretCard,
} from "./endpoint-detail-cards";
import {
	EndpointActionsMenu,
	EndpointsTabContent,
	WebhooksToolbar,
} from "./endpoint-list";
import { EventDeliverySummary, EventSubscriptionMenu } from "./event-pieces";
import {
	getErrorMessage,
	LoadingState,
	QueryErrorAlert,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
	showAsyncToast,
} from "./shared";
import {
	type CreateEndpointSubmission,
	type CreateEndpointSubmissionResult,
	type DeliveryTrendPoint,
	EMPTY_ENDPOINT_DELIVERY_STATS,
	type EndpointDeliveryStats,
	type EndpointDetailTab,
	formatCount,
	formatCountLabel,
	formatOptionalDate,
	getAttachedEndpointIds,
	getCreateEndpointInitialPublicKey,
	getDeliveriesForEvent,
	getEndpointDeliveryStats,
	getEndpointDeliveryTrend,
	getEndpointDisplayName,
	getEndpointPageSubtitle,
	getEndpointPageTitle,
	getEndpointSecondaryLabel,
	getEndpointsById,
	getEventSubscriptionSummary,
	getEventTriggerLabel,
	getRecentDeliveriesForEndpoint,
	getSelectedEndpointDeliveryStats,
	getWebhookEventReplayDisabledReason,
	getWebhookEventTypeDescription,
	isWebhookEndpointDirty,
	shouldShowMissingKeyAlert,
	TAB_OPTIONS,
	toggleEventSelection,
	type WebhooksTab,
} from "./utils";

function EventsTabContent({
	error,
	events,
	isLoading,
}: {
	error: unknown;
	events: WebhookEvent[];
	isLoading: boolean;
}) {
	let content: ReactNode;

	if (isLoading) {
		content = <LoadingState />;
	} else if (events.length === 0) {
		content = (
			<SectionMessage
				description="Webhook events will appear here once a subscribed endpoint receives verification activity."
				title="No webhook events yet"
			/>
		);
	} else {
		content = (
			<div className="overflow-hidden rounded-md border border-border/70">
				<Table className="w-full table-fixed">
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead className="w-[42%]">Event</TableHead>
							<TableHead className="w-[32%]">Origin</TableHead>
							<TableHead className="w-[12%]">Deliveries</TableHead>
							<TableHead className="w-[14%]">Created</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{events.map((event) => (
							<TableRow key={event.id}>
								<TableCell>
									<div className="min-w-0 space-y-0.5">
										<Link
											className="block truncate font-medium transition-colors hover:text-foreground/80 hover:underline"
											params={{ event: event.id }}
											search={{ tab: "events" }}
											to="/webhooks/events/$event"
										>
											{event.type}
										</Link>
										<div className="truncate font-mono text-muted-foreground text-xs">
											{event.id}
										</div>
									</div>
								</TableCell>
								<TableCell>
									<div className="min-w-0 space-y-1">
										<div className="text-sm">{getEventTriggerLabel(event)}</div>
										<div className="truncate font-mono text-muted-foreground text-xs">
											{event.trigger_id}
										</div>
									</div>
								</TableCell>
								<TableCell>
									<EventDeliverySummary deliveries={event.deliveries} />
								</TableCell>
								<TableCell>
									<div className="truncate text-muted-foreground text-sm tabular-nums">
										{formatDate(event.created_at)}
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<QueryErrorAlert
				error={error}
				fallback="Webhook events could not be loaded."
				title="Failed to load webhook events"
			/>
			{content}
		</div>
	);
}

function DeliveriesTabContent({
	context,
	deliveries,
	endpointsById,
	error,
	isLoading,
	isRetrying,
	onRetryDelivery,
}: {
	context: "endpoint" | "event";
	deliveries: WebhookDelivery[];
	endpointsById?: Record<string, WebhookEndpoint>;
	error: unknown;
	isLoading: boolean;
	isRetrying: boolean;
	onRetryDelivery: (deliveryId: string) => Promise<void>;
}) {
	let content: ReactNode;

	if (isLoading) {
		content = <LoadingState />;
	} else if (deliveries.length === 0) {
		content = (
			<SectionMessage
				description={
					context === "event"
						? "Delivery attempts for this event will appear here once endpoints begin receiving it."
						: "Delivery attempts for this endpoint will appear here after events are queued."
				}
				title={
					context === "event" ? "No delivery history yet" : "No deliveries yet"
				}
			/>
		);
	} else {
		content = (
			<div className="overflow-x-auto rounded-md border border-border/70">
				<Table>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Delivery</TableHead>
							<TableHead>
								{context === "event" ? "Endpoint" : "Event"}
							</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Attempts</TableHead>
							<TableHead>Response</TableHead>
							<TableHead>Last attempt</TableHead>
							<TableHead>
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{deliveries.map((delivery) => {
							const endpoint = endpointsById?.[delivery.webhook_endpoint_id];

							return (
								<TableRow key={delivery.id}>
									<TableCell className="min-w-[18rem]">
										<div className="space-y-1.5">
											<div className="font-mono text-sm">{delivery.id}</div>
											<div className="font-mono text-muted-foreground text-xs">
												{delivery.webhook_encryption_key_id ??
													"No encryption key"}
											</div>
										</div>
									</TableCell>
									<TableCell className="min-w-[16rem]">
										{context === "event" ? (
											<div className="space-y-1.5">
												{endpoint ? (
													<>
														<Link
															className="font-medium transition-colors hover:text-foreground/80 hover:underline"
															params={{ endpoint: endpoint.id }}
															to="/webhooks/$endpoint"
														>
															{getEndpointDisplayName(endpoint)}
														</Link>
														<div className="truncate text-muted-foreground text-xs">
															{getEndpointSecondaryLabel(endpoint)}
														</div>
													</>
												) : (
													<div className="font-mono text-xs">
														{delivery.webhook_endpoint_id}
													</div>
												)}
											</div>
										) : (
											<div className="space-y-1.5">
												<Link
													className="font-mono text-sm transition-colors hover:text-foreground/80 hover:underline"
													params={{ event: delivery.event_id }}
													search={{ tab: "events" }}
													to="/webhooks/events/$event"
												>
													{delivery.event_id}
												</Link>
												<div className="text-muted-foreground text-xs">
													Delivery event reference
												</div>
											</div>
										)}
									</TableCell>
									<TableCell>
										<StatusBadge status={delivery.status} />
									</TableCell>
									<TableCell className="text-sm tabular-nums">
										{delivery.attempt_count}
									</TableCell>
									<TableCell>
										<ResponseCodeBadge statusCode={delivery.last_status_code} />
									</TableCell>
									<TableCell className="text-muted-foreground text-sm tabular-nums">
										{formatOptionalDate(delivery.last_attempt_at)}
									</TableCell>
									<TableCell className="text-right">
										<Button
											disabled={isRetrying}
											onClick={() =>
												showAsyncToast(onRetryDelivery(delivery.id), {
													loading: "Retrying delivery...",
													success: "Delivery requeued",
													error: "Failed to retry delivery",
												})
											}
											size="sm"
											type="button"
											variant="outline"
										>
											Retry
										</Button>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<QueryErrorAlert
				error={error}
				fallback="Webhook deliveries could not be loaded."
				title="Failed to load deliveries"
			/>
			{content}
		</div>
	);
}

function EventAttachedEndpointsCard({
	endpointsById,
	error,
	event,
}: {
	endpointsById: Record<string, WebhookEndpoint>;
	error: unknown;
	event: WebhookEvent;
}) {
	let content: ReactNode;

	if (event.deliveries.length === 0) {
		content = (
			<SectionMessage
				description="This event has not been attached to any webhook endpoints yet."
				title="No attached endpoints"
			/>
		);
	} else {
		content = (
			<div className="overflow-x-auto rounded-md border border-border/70">
				<Table>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Endpoint</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Attempts</TableHead>
							<TableHead>Response</TableHead>
							<TableHead>Last attempt</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{event.deliveries.map((delivery) => {
							const endpoint = endpointsById[delivery.webhook_endpoint_id];

							return (
								<TableRow key={delivery.id}>
									<TableCell className="min-w-[18rem]">
										{endpoint ? (
											<div className="space-y-1.5">
												<Link
													className="font-medium transition-colors hover:text-foreground/80 hover:underline"
													params={{ endpoint: endpoint.id }}
													to="/webhooks/$endpoint"
												>
													{getEndpointDisplayName(endpoint)}
												</Link>
												<div className="truncate text-muted-foreground text-xs">
													{getEndpointSecondaryLabel(endpoint)}
												</div>
											</div>
										) : (
											<div className="space-y-1.5">
												<div className="font-mono text-sm">
													{delivery.webhook_endpoint_id}
												</div>
												<div className="text-muted-foreground text-xs">
													Endpoint details unavailable
												</div>
											</div>
										)}
									</TableCell>
									<TableCell>
										<StatusBadge status={delivery.status} />
									</TableCell>
									<TableCell className="text-sm tabular-nums">
										{delivery.attempt_count}
									</TableCell>
									<TableCell>
										<ResponseCodeBadge statusCode={delivery.last_status_code} />
									</TableCell>
									<TableCell className="text-muted-foreground text-sm tabular-nums">
										{formatOptionalDate(delivery.last_attempt_at)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<h2 className="font-medium text-sm">Attached endpoints</h2>
			<QueryErrorAlert
				error={error}
				fallback="Webhook endpoint details could not be loaded."
				title="Failed to load attached endpoints"
			/>
			{content}
		</div>
	);
}

function EventOverviewCard({
	event,
	isReplaying,
	onReplayEvent,
}: {
	event: WebhookEvent;
	isReplaying: boolean;
	onReplayEvent: (eventId: string) => Promise<void>;
}) {
	const replayDisabledReason = getWebhookEventReplayDisabledReason(event);

	return (
		<div className="space-y-4 rounded-md border border-border/70 p-5">
			<div className="flex items-center justify-between gap-3">
				<h2 className="font-medium text-sm">Replay options</h2>
			</div>

			<dl className="space-y-3 text-sm">
				<div className="flex items-center justify-between gap-4">
					<dt className="text-muted-foreground">Origin</dt>
					<dd className="text-right">{getEventTriggerLabel(event)}</dd>
				</div>
				<div className="flex items-center justify-between gap-4">
					<dt className="text-muted-foreground">Attached endpoints</dt>
					<dd className="font-medium tabular-nums">
						{formatCount(getAttachedEndpointIds(event).length)}
					</dd>
				</div>
				<div className="flex items-center justify-between gap-4">
					<dt className="text-muted-foreground">Created</dt>
					<dd className="text-right text-muted-foreground tabular-nums">
						{formatDate(event.created_at)}
					</dd>
				</div>
			</dl>

			<div className="space-y-2">
				{replayDisabledReason ? (
					<p className="text-muted-foreground text-sm">
						{replayDisabledReason}
					</p>
				) : (
					<p className="text-muted-foreground text-sm">
						Replay this event across every attached endpoint. Retry a single
						destination from the delivery history when you only need to requeue
						one attempt.
					</p>
				)}
				<p className="break-all font-mono text-muted-foreground text-xs">
					{event.trigger_id}
				</p>
			</div>

			<Button
				className="w-full"
				disabled={isReplaying || replayDisabledReason !== null}
				onClick={() =>
					showAsyncToast(onReplayEvent(event.id), {
						loading: "Replaying event...",
						success: "Webhook event replayed",
						error: "Failed to replay event",
					})
				}
				type="button"
			>
				{isReplaying ? (
					<Loader2Icon className="mr-2 size-4 animate-spin" />
				) : null}
				Replay event
			</Button>
		</div>
	);
}

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
		return (
			<div className="fixed inset-0">
				<Loading layout />
			</div>
		);
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
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col">
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

export function WebhookEndpointPage({ endpointId }: { endpointId: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<EndpointDetailTab>("overview");
	const [endpointName, setEndpointName] = useState("");
	const [endpointUrl, setEndpointUrl] = useState("");
	const [endpointEnabled, setEndpointEnabled] = useState(true);
	const [endpointSubscribedEventTypes, setEndpointSubscribedEventTypes] =
		useState<string[]>([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
	const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

	const endpointsQuery = useQuery({
		queryKey: ["webhooks", "endpoints"],
		queryFn: () =>
			listWebhookEndpoints({
				limit: 50,
			}),
	});

	const endpoint =
		endpointsQuery.data?.data.find((item) => item.id === endpointId) ?? null;

	const keysQuery = useQuery({
		enabled: Boolean(endpoint),
		queryKey: ["webhooks", "keys", endpointId],
		queryFn: () =>
			listWebhookKeys({
				endpointId,
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

	useEffect(() => {
		if (!endpoint) {
			setEndpointName("");
			setEndpointUrl("");
			setEndpointEnabled(true);
			setEndpointSubscribedEventTypes([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
			setRevealedSecret(null);
			return;
		}

		setEndpointName(endpoint.name ?? "");
		setEndpointUrl(endpoint.url);
		setEndpointEnabled(endpoint.enabled);
		setEndpointSubscribedEventTypes(endpoint.subscribed_event_types);
		setRevealedSecret(null);
	}, [endpoint]);

	const updateEndpointMutation = useMutation({
		mutationFn: updateWebhookEndpoint,
	});
	const revealSecretMutation = useMutation({
		mutationFn: revealWebhookSigningSecret,
	});
	const rotateSecretMutation = useMutation({
		mutationFn: rotateWebhookSigningSecret,
	});
	const deleteEndpointMutation = useMutation({
		mutationFn: deleteWebhookEndpoint,
	});
	const createKeyMutation = useMutation({
		mutationFn: createWebhookKey,
	});
	const deactivateKeyMutation = useMutation({
		mutationFn: deactivateWebhookKey,
	});
	const reactivateKeyMutation = useMutation({
		mutationFn: reactivateWebhookKey,
	});
	const retryDeliveryMutation = useMutation({
		mutationFn: retryWebhookDelivery,
	});

	const keys = keysQuery.data?.data ?? [];
	const deliveries = deliveriesQuery.data?.data ?? [];
	const endpointDeliveries = getRecentDeliveriesForEndpoint(
		deliveries,
		endpointId,
	);
	const endpointDeliveryTrend = getEndpointDeliveryTrend(
		deliveries,
		endpointId,
	);
	const endpointDeliveryStats = getSelectedEndpointDeliveryStats(
		deliveries,
		endpoint,
	);
	const isEndpointDirty = isWebhookEndpointDirty({
		endpoint,
		endpointEnabled,
		endpointName,
		endpointSubscribedEventTypes,
		endpointUrl,
	});
	const showMissingKeyAlert = shouldShowMissingKeyAlert({
		endpoint,
		isKeysLoading: keysQuery.isLoading,
		keys,
	});

	function refreshWebhookQueries(): Promise<void> {
		return queryClient.invalidateQueries({ queryKey: ["webhooks"] });
	}

	function resetEndpointDraft(): void {
		if (!endpoint) {
			return;
		}

		setEndpointName(endpoint.name ?? "");
		setEndpointUrl(endpoint.url);
		setEndpointEnabled(endpoint.enabled);
		setEndpointSubscribedEventTypes(endpoint.subscribed_event_types);
	}

	async function handleSaveEndpoint(): Promise<void> {
		if (!endpoint) {
			return;
		}

		if (!endpointUrl.trim()) {
			throw new Error("Webhook URL is required.");
		}

		await updateEndpointMutation.mutateAsync({
			endpointId: endpoint.id,
			name: endpointName.trim() || null,
			url: endpointUrl.trim(),
			enabled: endpointEnabled,
			subscribedEventTypes: endpointSubscribedEventTypes,
		});
		await refreshWebhookQueries();
	}

	async function handleToggleEndpointEnabled(
		nextEndpoint: WebhookEndpoint,
	): Promise<void> {
		await updateEndpointMutation.mutateAsync({
			endpointId: nextEndpoint.id,
			enabled: !nextEndpoint.enabled,
			name: nextEndpoint.name,
			subscribedEventTypes: nextEndpoint.subscribed_event_types,
			url: nextEndpoint.url,
		});
		await refreshWebhookQueries();
	}

	async function handleDeleteEndpoint(
		nextEndpoint: WebhookEndpoint,
	): Promise<void> {
		await deleteEndpointMutation.mutateAsync(nextEndpoint.id);
		await refreshWebhookQueries();
		navigate({ replace: true, to: "/webhooks" });
	}

	async function handleRevealSecret(): Promise<void> {
		if (revealedSecret) {
			setRevealedSecret(null);
			return;
		}

		const result = await revealSecretMutation.mutateAsync(endpointId);
		setRevealedSecret(result.signing_secret);
	}

	async function handleRotateSecret(): Promise<void> {
		const result = await rotateSecretMutation.mutateAsync(endpointId);
		await refreshWebhookQueries();
		setRevealedSecret(result.signing_secret);
	}

	async function handleCreateKey(input: {
		endpointId: string;
		jwk: JsonWebKey;
		keyId: string;
	}): Promise<void> {
		await createKeyMutation.mutateAsync(input);
		await refreshWebhookQueries();
	}

	async function handleDeactivateKey(keyId: string): Promise<void> {
		await deactivateKeyMutation.mutateAsync(keyId);
		await refreshWebhookQueries();
	}

	async function handleReactivateKey(keyId: string): Promise<void> {
		await reactivateKeyMutation.mutateAsync(keyId);
		await refreshWebhookQueries();
	}

	async function handleRetryDelivery(deliveryId: string): Promise<void> {
		await retryDeliveryMutation.mutateAsync(deliveryId);
		await refreshWebhookQueries();
	}

	if (endpointsQuery.isLoading && !endpointsQuery.data) {
		return (
			<div className="fixed inset-0">
				<Loading layout />
			</div>
		);
	}

	if (endpointsQuery.error) {
		return (
			<InfoCard
				buttons={{
					primary: {
						href: "/webhooks",
						label: "Back to webhooks",
					},
				}}
				colour="red"
				footer={false}
				header={{
					title: "Error",
					description: "Failed to load webhook endpoint",
				}}
				message={{
					title: "Webhook endpoint unavailable",
					description: getErrorMessage(
						endpointsQuery.error,
						"Failed to load webhook endpoint.",
					),
				}}
			/>
		);
	}

	if (!endpoint) {
		return (
			<InfoCard
				buttons={{
					primary: {
						href: "/webhooks",
						label: "Back to webhooks",
					},
				}}
				colour="red"
				footer={false}
				header={{
					title: "Not Found",
					description: "Webhook endpoint not found",
				}}
				message={{
					title: "Endpoint not found",
					description:
						"The webhook endpoint you're looking for doesn't exist or is no longer available.",
				}}
			/>
		);
	}

	const isEndpointMutating =
		updateEndpointMutation.isPending || deleteEndpointMutation.isPending;

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col">
			<div className="space-y-6">
				<Link
					className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
					to="/webhooks"
				>
					<ChevronLeftIcon className="size-4" />
					Back to webhooks
				</Link>

				<div className="flex flex-col gap-4 border-border/70 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
					<div className="min-w-0 space-y-2">
						<div className="flex flex-wrap items-center gap-3">
							<h1 className="font-light text-3xl text-foreground tracking-tight">
								{getEndpointPageTitle(endpoint)}
							</h1>
							<StatusBadge status={endpoint.enabled ? "active" : "disabled"} />
						</div>
						<p className="break-all text-muted-foreground text-sm">
							{getEndpointPageSubtitle(endpoint)}
						</p>
					</div>

					<div className="flex items-center gap-2">
						<EditEndpointDrawer
							endpointEnabled={endpointEnabled}
							endpointName={endpointName}
							endpointSubscribedEventTypes={endpointSubscribedEventTypes}
							endpointUrl={endpointUrl}
							isDirty={isEndpointDirty}
							isSaving={updateEndpointMutation.isPending}
							onEndpointEnabledChange={setEndpointEnabled}
							onEndpointNameChange={setEndpointName}
							onEndpointUrlChange={setEndpointUrl}
							onReset={resetEndpointDraft}
							onSaveEndpoint={handleSaveEndpoint}
							onToggleEndpointEventType={(eventType) =>
								setEndpointSubscribedEventTypes((currentValue) =>
									toggleEventSelection(currentValue, eventType),
								)
							}
						/>
						<EndpointActionsMenu
							endpoint={endpoint}
							isMutating={isEndpointMutating}
							onDeleteEndpoint={handleDeleteEndpoint}
							onToggleEndpointEnabled={handleToggleEndpointEnabled}
							showViewDetails={false}
							triggerVariant="ghost"
						/>
					</div>
				</div>

				<Tabs
					className="gap-6"
					onValueChange={(value) => setActiveTab(value as EndpointDetailTab)}
					value={activeTab}
				>
					<TabsList
						className="h-auto w-full justify-start gap-5 rounded-none bg-transparent p-0"
						variant="line"
					>
						<TabsTrigger
							className="h-10 flex-none rounded-none px-0 pb-2 data-active:bg-transparent"
							value="overview"
						>
							Overview
						</TabsTrigger>
						<TabsTrigger
							className="h-10 flex-none rounded-none px-0 pb-2 data-active:bg-transparent"
							value="performance"
						>
							Performance
						</TabsTrigger>
						<TabsTrigger
							className="h-10 flex-none rounded-none px-0 pb-2 data-active:bg-transparent"
							value="deliveries"
						>
							Event deliveries
						</TabsTrigger>
					</TabsList>

					<TabsContent className="space-y-6" value="overview">
						{showMissingKeyAlert ? (
							<Alert>
								<ShieldAlertIcon className="size-4" />
								<AlertTitle>No active public key</AlertTitle>
								<AlertDescription>
									New deliveries to this endpoint will fail until an active
									encryption key is added.
								</AlertDescription>
							</Alert>
						) : null}

						<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)]">
							<div className="space-y-6">
								<EndpointDetailsPanel endpoint={endpoint} />
								<EndpointResourcesCard />
							</div>

							<div className="space-y-6">
								<EndpointSigningSecretCard
									isRevealing={revealSecretMutation.isPending}
									isRotating={rotateSecretMutation.isPending}
									onRevealSecret={handleRevealSecret}
									onRotateSecret={handleRotateSecret}
									secret={revealedSecret}
								/>
								<EndpointKeysCard
									endpointId={endpoint.id}
									error={keysQuery.error}
									isLoading={keysQuery.isLoading}
									isUpdating={
										deactivateKeyMutation.isPending ||
										reactivateKeyMutation.isPending
									}
									keys={keys}
									onCreateKey={handleCreateKey}
									onDeactivateKey={handleDeactivateKey}
									onReactivateKey={handleReactivateKey}
								/>
							</div>
						</div>
					</TabsContent>

					<TabsContent className="space-y-6" value="performance">
						<QueryErrorAlert
							error={deliveriesQuery.error}
							fallback="Endpoint deliveries could not be loaded."
							title="Failed to load endpoint deliveries"
						/>

						<EndpointPerformancePanel
							endpointDeliveryStats={endpointDeliveryStats}
							isDeliveriesLoading={deliveriesQuery.isLoading}
							trendPoints={endpointDeliveryTrend}
						/>
					</TabsContent>

					<TabsContent className="space-y-4" value="deliveries">
						<DeliveriesTabContent
							context="endpoint"
							deliveries={endpointDeliveries}
							error={deliveriesQuery.error}
							isLoading={deliveriesQuery.isLoading}
							isRetrying={retryDeliveryMutation.isPending}
							onRetryDelivery={handleRetryDelivery}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}

function CreateEndpointDrawer({
	onSubmit,
}: {
	onSubmit: (
		input: CreateEndpointSubmission,
	) => Promise<CreateEndpointSubmissionResult>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
	const [enabled, setEnabled] = useState(true);
	const [name, setName] = useState("");
	const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([
		...SUPPORTED_WEBHOOK_EVENT_TYPES,
	]);
	const [shouldConfigurePublicKey, setShouldConfigurePublicKey] =
		useState(false);
	const [publicKeyId, setPublicKeyId] = useState("");
	const [publicKeyInput, setPublicKeyInput] = useState("");
	const [url, setUrl] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	function resetState() {
		setIsSubmitting(false);
		setIsMoreOptionsOpen(false);
		setEnabled(true);
		setName("");
		setSelectedEventTypes([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
		setShouldConfigurePublicKey(false);
		setPublicKeyId("");
		setPublicKeyInput("");
		setUrl("");
		setErrorMessage("");
	}

	async function handleSubmit() {
		setErrorMessage("");

		try {
			if (!url.trim()) {
				throw new Error("Webhook URL is required.");
			}

			if (selectedEventTypes.length === 0) {
				throw new Error("Select at least one event type.");
			}

			setIsSubmitting(true);
			const result = await onSubmit({
				enabled,
				initialPublicKey: await getCreateEndpointInitialPublicKey({
					publicKeyId,
					publicKeyInput,
					shouldConfigurePublicKey,
				}),
				name: name.trim() || null,
				subscribedEventTypes: selectedEventTypes,
				url: url.trim(),
			});

			setIsOpen(false);
			toast.success("Webhook endpoint created");

			if (result.publicKeyError) {
				toast.error(result.publicKeyError);
			}
		} catch (error) {
			setErrorMessage(
				error instanceof Error
					? error.message
					: "Failed to create webhook endpoint.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Sheet
			onOpenChange={setIsOpen}
			onOpenChangeComplete={(open) => {
				if (!open) {
					resetState();
				}
			}}
			open={isOpen}
		>
			<SheetTrigger
				render={
					<Button onClick={() => setIsOpen(true)}>
						<PlusIcon className="mr-2 size-4" />
						Create endpoint
					</Button>
				}
			/>
			<SheetContent
				className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
				side="right"
			>
				<div className="border-border/70 border-b px-6 py-5">
					<SheetTitle>Create webhook endpoint</SheetTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						Configure the destination, subscribed events, and active encryption
						key from one surface.
					</p>
				</div>

				<div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
					{errorMessage ? (
						<Alert variant="destructive">
							<AlertTitle>Failed to create endpoint</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					) : null}

					<div className="space-y-2">
						<Label htmlFor="create-webhook-name">Endpoint name</Label>
						<Input
							id="create-webhook-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Primary production webhook"
							value={name}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="create-webhook-url">Destination URL</Label>
						<Input
							id="create-webhook-url"
							inputMode="url"
							onChange={(event) => {
								setUrl(event.target.value);
								setErrorMessage("");
							}}
							placeholder="https://example.com/webhooks/kayle"
							value={url}
						/>
					</div>

					<div className="space-y-2">
						<Label>Event subscriptions</Label>
						<EventSubscriptionMenu
							onToggleEventType={(eventType) =>
								setSelectedEventTypes((currentValue) =>
									toggleEventSelection(currentValue, eventType),
								)
							}
							selectedEventTypes={selectedEventTypes}
						/>
					</div>

					<div className="overflow-hidden rounded-md border border-border/70">
						<button
							aria-controls="create-endpoint-more-options"
							aria-expanded={isMoreOptionsOpen}
							className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
							onClick={() =>
								setIsMoreOptionsOpen((currentValue) => !currentValue)
							}
							type="button"
						>
							<div className="space-y-0.5">
								<div className="font-medium text-sm">More options</div>
								<p className="text-muted-foreground text-sm">
									Enabled state and initial public key configuration.
								</p>
							</div>
							<ChevronDownIcon
								className={cn(
									"size-4 shrink-0 text-muted-foreground transition-transform",
									isMoreOptionsOpen ? "rotate-180" : undefined,
								)}
							/>
						</button>

						{isMoreOptionsOpen ? (
							<div
								className="space-y-4 border-border/70 border-t px-4 py-4"
								id="create-endpoint-more-options"
							>
								<div className="flex items-center justify-between gap-6">
									<div className="space-y-0.5">
										<Label htmlFor="create-endpoint-enabled">Enabled</Label>
										<p className="text-muted-foreground text-sm">
											Start receiving deliveries immediately after creation.
										</p>
									</div>
									<Switch
										checked={enabled}
										id="create-endpoint-enabled"
										onCheckedChange={setEnabled}
									/>
								</div>

								<div className="space-y-3 border-border/70 border-t pt-4">
									<div className="flex items-center justify-between gap-6">
										<div className="space-y-0.5">
											<Label htmlFor="create-endpoint-public-key">
												Configure public key
											</Label>
											<p className="text-muted-foreground text-sm">
												Add the initial active encryption key now so new
												deliveries do not fail for missing key material.
											</p>
										</div>
										<Switch
											checked={shouldConfigurePublicKey}
											id="create-endpoint-public-key"
											onCheckedChange={setShouldConfigurePublicKey}
										/>
									</div>

									{shouldConfigurePublicKey ? (
										<PublicKeyFields
											jwkInput={publicKeyInput}
											jwkInputId="create-endpoint-jwk"
											keyId={publicKeyId}
											keyIdId="create-endpoint-key-id"
											onJwkInputChange={(value) => {
												setPublicKeyInput(value);
												setErrorMessage("");
											}}
											onKeyIdChange={setPublicKeyId}
										/>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				</div>

				<div className="flex items-center justify-end gap-3 border-border/70 border-t px-6 py-4">
					<Button
						onClick={() => setIsOpen(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={isSubmitting} onClick={handleSubmit} type="button">
						{isSubmitting ? (
							<Loader2Icon className="mr-2 size-4 animate-spin" />
						) : null}
						Create endpoint
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
