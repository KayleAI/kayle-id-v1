import {
	DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	SUPPORTED_WEBHOOK_EVENT_TYPES,
} from "@kayle-id/config/webhook-events";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import { Tabs, TabsContent } from "@kayle-id/ui/components/tabs";
import { InfoCard } from "@kayle-id/ui/info-card";
import { cn } from "@kayle-id/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Loading } from "@/components/loading";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { DeliveriesTabContent } from "@/components/webhooks/deliveries/tab";
import {
	EndpointDetailsPanel,
	EndpointKeysCard,
	EndpointPerformancePanel,
} from "@/components/webhooks/endpoints/detail-cards";
import { EditEndpointDrawer } from "@/components/webhooks/endpoints/edit-drawer";
import { EndpointActionsMenu } from "@/components/webhooks/endpoints/list";
import { getErrorMessage } from "@/utils/get-error-message";
import {
	createWebhookKey,
	deactivateWebhookKey,
	deleteWebhookEndpoint,
	listWebhookDeliveries,
	listWebhookEndpoints,
	listWebhookKeys,
	reactivateWebhookKey,
	retryWebhookDelivery,
	revealWebhookSigningSecret,
	rotateWebhookSigningSecret,
	updateWebhookEndpoint,
	type WebhookEndpoint,
} from "./api";
import {
	type EndpointDetailTab,
	getEndpointDeliveryTrend,
	getEndpointLabelsInput,
	getEndpointPageSubtitle,
	getEndpointPageTitle,
	getRecentDeliveriesForEndpoint,
	isWebhookEndpointDirty,
	parseEndpointLabels,
	shouldShowMissingKeyAlert,
	toggleEventSelection,
} from "./utils";

const ENDPOINT_DETAIL_TABS: Array<{
	label: string;
	value: EndpointDetailTab;
}> = [
	{ label: "Overview", value: "overview" },
	{ label: "Public keys", value: "public-keys" },
	{ label: "Event deliveries", value: "deliveries" },
];

const ENDPOINT_DETAIL_PAGE_SIZE = 50;

export function WebhookEndpointPage({ endpointId }: { endpointId: string }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<EndpointDetailTab>("overview");
	const [endpointLabelsInput, setEndpointLabelsInput] = useState("");
	const [endpointName, setEndpointName] = useState("");
	const [endpointUrl, setEndpointUrl] = useState("");
	const [endpointEnabled, setEndpointEnabled] = useState(true);
	const [
		endpointUndeliveredPayloadRetentionHours,
		setEndpointUndeliveredPayloadRetentionHours,
	] = useState(DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS);
	const [endpointSubscribedEventTypes, setEndpointSubscribedEventTypes] =
		useState<string[]>([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
	const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

	const endpointsQuery = useQuery({
		queryKey: ["webhooks", "endpoints"],
		queryFn: () =>
			listWebhookEndpoints({
				limit: ENDPOINT_DETAIL_PAGE_SIZE,
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
				limit: ENDPOINT_DETAIL_PAGE_SIZE,
			}),
	});

	const deliveriesQuery = useQuery({
		queryKey: ["webhooks", "deliveries"],
		queryFn: () =>
			listWebhookDeliveries({
				limit: ENDPOINT_DETAIL_PAGE_SIZE,
			}),
	});

	useEffect(() => {
		if (!endpoint) {
			setEndpointLabelsInput("");
			setEndpointName("");
			setEndpointUrl("");
			setEndpointEnabled(true);
			setEndpointUndeliveredPayloadRetentionHours(
				DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
			);
			setEndpointSubscribedEventTypes([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
			setRevealedSecret(null);
			return;
		}

		setEndpointLabelsInput(getEndpointLabelsInput(endpoint.labels));
		setEndpointName(endpoint.name ?? "");
		setEndpointUrl(endpoint.url);
		setEndpointEnabled(endpoint.enabled);
		setEndpointUndeliveredPayloadRetentionHours(
			endpoint.undelivered_payload_retention_hours,
		);
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
	const isEndpointDirty = isWebhookEndpointDirty({
		endpoint,
		endpointEnabled,
		endpointLabelsInput,
		endpointName,
		endpointSubscribedEventTypes,
		endpointUndeliveredPayloadRetentionHours,
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
		setEndpointLabelsInput(getEndpointLabelsInput(endpoint.labels));
		setEndpointUrl(endpoint.url);
		setEndpointEnabled(endpoint.enabled);
		setEndpointUndeliveredPayloadRetentionHours(
			endpoint.undelivered_payload_retention_hours,
		);
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
			labels: parseEndpointLabels(endpointLabelsInput),
			name: endpointName.trim() || null,
			url: endpointUrl.trim(),
			enabled: endpointEnabled,
			subscribedEventTypes: endpointSubscribedEventTypes,
			undeliveredPayloadRetentionHours:
				endpointUndeliveredPayloadRetentionHours,
		});
		await refreshWebhookQueries();
	}

	async function handleToggleEndpointEnabled(
		nextEndpoint: WebhookEndpoint,
	): Promise<void> {
		await updateEndpointMutation.mutateAsync({
			endpointId: nextEndpoint.id,
			enabled: !nextEndpoint.enabled,
			labels: nextEndpoint.labels,
			name: nextEndpoint.name,
			subscribedEventTypes: nextEndpoint.subscribed_event_types,
			undeliveredPayloadRetentionHours:
				nextEndpoint.undelivered_payload_retention_hours,
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
		return <Loading />;
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
	const endpointPageTitle = getEndpointPageTitle(endpoint);
	const endpointPageSubtitle = getEndpointPageSubtitle(endpoint);

	return (
		<div className="mx-auto flex h-full min-w-0 max-w-7xl flex-1 grow flex-col w-full">
			<div className="min-w-0 space-y-6">
				<Link
					className="inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
					to="/webhooks"
				>
					<ChevronLeftIcon className="size-4" />
					Back to webhooks
				</Link>

				<Tabs
					className="min-w-0 gap-5"
					onValueChange={(value) => setActiveTab(value as EndpointDetailTab)}
					value={activeTab}
				>
					<div className="border-border/70 border-b">
						<div className="flex flex-col gap-4 pb-4 lg:flex-row lg:items-start lg:justify-between">
							<div className="max-w-full min-w-0 overflow-hidden space-y-2 lg:flex-1">
								<h1
									className="block max-w-full truncate font-light text-3xl text-foreground tracking-tight"
									title={endpointPageTitle}
								>
									{endpointPageTitle}
								</h1>
								{endpointPageSubtitle ? (
									<p className="break-all text-muted-foreground text-sm">
										{endpointPageSubtitle}
									</p>
								) : null}
							</div>

							<div className="flex items-center gap-2">
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

						<nav aria-label="Webhook destination sections">
							<ul className="-mb-px flex flex-wrap gap-x-6">
								{ENDPOINT_DETAIL_TABS.map((tab) => (
									<li key={tab.value}>
										<button
											className={cn(
												"inline-flex items-center border-b-2 px-1 py-3 font-medium text-sm transition-colors",
												activeTab === tab.value
													? "border-foreground text-foreground"
													: "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
											)}
											onClick={() => setActiveTab(tab.value)}
											type="button"
										>
											{tab.label}
										</button>
									</li>
								))}
							</ul>
						</nav>
					</div>

					<TabsContent className="min-w-0 space-y-6" value="overview">
						<QueryErrorAlert
							error={deliveriesQuery.error}
							fallback="Endpoint deliveries could not be loaded."
							title="Failed to load endpoint deliveries"
						/>
						<div className="grid min-w-0 gap-6">
							<EndpointDetailsPanel
								action={
									<EditEndpointDrawer
										endpointEnabled={endpointEnabled}
										endpointLabelsInput={endpointLabelsInput}
										endpointName={endpointName}
										endpointSubscribedEventTypes={endpointSubscribedEventTypes}
										endpointUndeliveredPayloadRetentionHours={
											endpointUndeliveredPayloadRetentionHours
										}
										endpointUrl={endpointUrl}
										isDirty={isEndpointDirty}
										isSaving={updateEndpointMutation.isPending}
										onEndpointEnabledChange={setEndpointEnabled}
										onEndpointLabelsInputChange={setEndpointLabelsInput}
										onEndpointNameChange={setEndpointName}
										onEndpointUndeliveredPayloadRetentionHoursChange={
											setEndpointUndeliveredPayloadRetentionHours
										}
										onEndpointUrlChange={setEndpointUrl}
										onReset={resetEndpointDraft}
										onSaveEndpoint={handleSaveEndpoint}
										onToggleEndpointEventType={(eventType) =>
											setEndpointSubscribedEventTypes((currentValue) =>
												toggleEventSelection(currentValue, eventType),
											)
										}
									/>
								}
								endpoint={endpoint}
								isSecretRevealing={revealSecretMutation.isPending}
								isSecretRotating={rotateSecretMutation.isPending}
								onRevealSecret={handleRevealSecret}
								onRotateSecret={handleRotateSecret}
								secret={revealedSecret}
							/>
							<EndpointPerformancePanel
								isDeliveriesLoading={deliveriesQuery.isLoading}
								trendPoints={endpointDeliveryTrend}
							/>
						</div>
					</TabsContent>

					<TabsContent className="min-w-0 space-y-6" value="public-keys">
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
					</TabsContent>

					<TabsContent className="min-w-0 space-y-4" value="deliveries">
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
