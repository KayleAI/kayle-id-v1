import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import InfoCard from "@kayle-id/ui/info-card";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@kayleai/ui/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ShieldAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Loading } from "@/components/loading";
import { DeliveriesTabContent } from "@/components/webhooks/deliveries/tab";
import {
	EndpointDetailsPanel,
	EndpointKeysCard,
	EndpointPerformancePanel,
	EndpointResourcesCard,
	EndpointSigningSecretCard,
} from "@/components/webhooks/endpoints/detail-cards";
import { EditEndpointDrawer } from "@/components/webhooks/endpoints/edit-drawer";
import { EndpointActionsMenu } from "@/components/webhooks/endpoints/list";
import {
	getErrorMessage,
	QueryErrorAlert,
	StatusBadge,
} from "@/components/webhooks/shared";
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
	getEndpointPageSubtitle,
	getEndpointPageTitle,
	getRecentDeliveriesForEndpoint,
	getSelectedEndpointDeliveryStats,
	isWebhookEndpointDirty,
	shouldShowMissingKeyAlert,
	toggleEventSelection,
} from "./utils";

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

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
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
