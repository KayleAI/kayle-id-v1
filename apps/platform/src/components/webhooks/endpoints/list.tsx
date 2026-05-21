import { Button } from "@kayle-id/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayle-id/ui/components/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { cn } from "@kayle-id/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	EllipsisVerticalIcon,
	EyeIcon,
	PauseIcon,
	PlayIcon,
	TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { WebhookEndpoint } from "@/app/webhooks/api";
import {
	EMPTY_ENDPOINT_DELIVERY_STATS,
	type EndpointDeliveryStats,
	getEndpointDisplayName,
	getEventSubscriptionSummary,
	TAB_OPTIONS,
	type WebhooksTab,
} from "@/app/webhooks/utils";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { RelativeTime } from "@/components/relative-time";
import {
	EndpointLabels,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
} from "../shared";

export function WebhooksToolbar({
	activeTab,
	onActiveTabChange,
}: {
	activeTab: WebhooksTab;
	onActiveTabChange: (tab: WebhooksTab) => void;
}) {
	return (
		<nav aria-label="Webhook sections" className="border-b border-border/70">
			<ul className="-mb-px flex flex-wrap gap-x-6">
				{TAB_OPTIONS.map((tab) => (
					<li key={tab.value}>
						<button
							className={cn(
								"inline-flex items-center border-b-2 px-1 py-3 font-medium text-sm transition-colors",
								activeTab === tab.value
									? "border-foreground text-foreground"
									: "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
							)}
							onClick={() => onActiveTabChange(tab.value)}
							type="button"
						>
							{tab.label}
						</button>
					</li>
				))}
			</ul>
		</nav>
	);
}

export function EndpointActionsMenu({
	align = "end",
	endpoint,
	isMutating,
	onDeleteEndpoint,
	onToggleEndpointEnabled,
	showViewDetails = true,
	triggerVariant = "ghost",
}: {
	align?: "end" | "start";
	endpoint: WebhookEndpoint;
	isMutating: boolean;
	onDeleteEndpoint: (endpoint: WebhookEndpoint) => Promise<void>;
	onToggleEndpointEnabled: (endpoint: WebhookEndpoint) => Promise<void>;
	showViewDetails?: boolean;
	triggerVariant?: "ghost" | "outline";
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						aria-label={`More actions for ${getEndpointDisplayName(endpoint)}`}
						size="icon"
						variant={triggerVariant}
					/>
				}
			>
				<EllipsisVerticalIcon className="size-4" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align={align}>
				{showViewDetails ? (
					<DropdownMenuItem
						render={
							<Button
								className="flex w-full items-center justify-start"
								nativeButton={false}
								render={
									<Link
										params={{ endpoint: endpoint.id }}
										to="/webhooks/$endpoint"
									/>
								}
								variant="ghost"
							/>
						}
					>
						<EyeIcon className="size-4" />
						View details
					</DropdownMenuItem>
				) : null}
				<DropdownMenuItem
					disabled={isMutating}
					nativeButton
					onClick={() => {
						toast.promise(onToggleEndpointEnabled(endpoint), {
							loading: endpoint.enabled
								? "Pausing destination..."
								: "Enabling destination...",
							success: endpoint.enabled
								? "Destination paused"
								: "Destination enabled",
							error: endpoint.enabled
								? "Failed to pause destination"
								: "Failed to enable destination",
						});
					}}
					render={
						<Button
							className="flex w-full items-center justify-start"
							variant="ghost"
						/>
					}
				>
					{endpoint.enabled ? (
						<PauseIcon className="size-4" />
					) : (
						<PlayIcon className="size-4" />
					)}
					{endpoint.enabled ? "Pause destination" : "Enable destination"}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					disabled={isMutating}
					nativeButton
					onClick={() => {
						toast.promise(onDeleteEndpoint(endpoint), {
							loading: "Deleting destination...",
							success: "Destination deleted",
							error: "Failed to delete destination",
						});
					}}
					render={
						<Button
							className="flex w-full items-center justify-start"
							variant="ghost"
						/>
					}
					variant="destructive"
				>
					<TrashIcon className="size-4" />
					Delete destination
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function EndpointListCard({
	deliveryStatsByEndpoint,
	endpoints,
	isMutatingEndpointId,
	onDeleteEndpoint,
	onToggleEndpointEnabled,
}: {
	deliveryStatsByEndpoint: Record<string, EndpointDeliveryStats>;
	endpoints: WebhookEndpoint[];
	isMutatingEndpointId: string | null;
	onDeleteEndpoint: (endpoint: WebhookEndpoint) => Promise<void>;
	onToggleEndpointEnabled: (endpoint: WebhookEndpoint) => Promise<void>;
}) {
	if (endpoints.length === 0) {
		return (
			<SectionMessage
				description="Create your first webhook endpoint to start receiving verification events."
				title="No webhook endpoints yet"
			/>
		);
	}

	return (
		<div className="overflow-x-auto rounded-md border border-border/70">
			<Table className="w-full min-w-[980px] table-fixed">
				<colgroup>
					<col className="w-[36%]" />
					<col className="w-[16%]" />
					<col className="w-[18%]" />
					<col className="w-24" />
					<col className="w-40" />
					<col className="w-14" />
				</colgroup>
				<TableHeader className="bg-muted/30">
					<TableRow>
						<TableHead>Destination</TableHead>
						<TableHead>Labels</TableHead>
						<TableHead>Listening to</TableHead>
						<TableHead className="whitespace-nowrap">Status</TableHead>
						<TableHead>Last delivery</TableHead>
						<TableHead className="w-14 text-right">
							<span className="sr-only">More actions</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{endpoints.map((endpoint) => {
						const deliveryStats =
							deliveryStatsByEndpoint[endpoint.id] ??
							EMPTY_ENDPOINT_DELIVERY_STATS;
						const endpointName = endpoint.name?.trim();

						return (
							<TableRow key={endpoint.id}>
								<TableCell className="align-middle">
									<div className="min-w-0 space-y-1.5">
										<Link
											className="block truncate font-medium transition-colors hover:text-foreground/80 hover:underline"
											params={{ endpoint: endpoint.id }}
											to="/webhooks/$endpoint"
										>
											{endpointName || endpoint.url}
										</Link>
										{endpointName ? (
											<div className="break-all text-muted-foreground text-xs">
												{endpoint.url}
											</div>
										) : null}
									</div>
								</TableCell>
								<TableCell className="align-middle">
									<EndpointLabels labels={endpoint.labels} />
								</TableCell>
								<TableCell className="align-middle">
									<div className="font-medium text-sm">
										{getEventSubscriptionSummary(
											endpoint.subscribed_event_types,
										)}
									</div>
								</TableCell>
								<TableCell className="align-middle">
									<StatusBadge
										status={endpoint.enabled ? "active" : "disabled"}
									/>
								</TableCell>
								<TableCell className="align-middle">
									<div className="flex items-center gap-2">
										<div className="truncate text-muted-foreground text-sm tabular-nums">
											{deliveryStats.lastAttemptAt ? (
												<RelativeTime iso={deliveryStats.lastAttemptAt} />
											) : (
												"Never"
											)}
										</div>
										<ResponseCodeBadge
											statusCode={deliveryStats.lastStatusCode}
										/>
									</div>
								</TableCell>
								<TableCell className="w-14 text-right">
									<EndpointActionsMenu
										endpoint={endpoint}
										isMutating={isMutatingEndpointId === endpoint.id}
										onDeleteEndpoint={onDeleteEndpoint}
										onToggleEndpointEnabled={onToggleEndpointEnabled}
									/>
								</TableCell>
							</TableRow>
						);
					})}
				</TableBody>
			</Table>
		</div>
	);
}

export function EndpointsTabContent({
	deliveryStatsByEndpoint,
	endpointError,
	endpoints,
	hasNextPage,
	hasPreviousPage,
	isFetchingPage,
	isMutatingEndpointId,
	onDeleteEndpoint,
	onNextPage,
	onPreviousPage,
	onToggleEndpointEnabled,
	pageLabel,
}: {
	deliveryStatsByEndpoint: Record<string, EndpointDeliveryStats>;
	endpointError: unknown;
	endpoints: WebhookEndpoint[];
	hasNextPage: boolean;
	hasPreviousPage: boolean;
	isFetchingPage: boolean;
	isMutatingEndpointId: string | null;
	onDeleteEndpoint: (endpoint: WebhookEndpoint) => Promise<void>;
	onNextPage: () => void;
	onPreviousPage: () => void;
	onToggleEndpointEnabled: (endpoint: WebhookEndpoint) => Promise<void>;
	pageLabel: string;
}) {
	const showPagination = hasPreviousPage || hasNextPage;

	return (
		<div className="space-y-6">
			<QueryErrorAlert
				error={endpointError}
				fallback="Webhook endpoints could not be loaded."
				title="Failed to load webhook endpoints"
			/>

			<EndpointListCard
				deliveryStatsByEndpoint={deliveryStatsByEndpoint}
				endpoints={endpoints}
				isMutatingEndpointId={isMutatingEndpointId}
				onDeleteEndpoint={onDeleteEndpoint}
				onToggleEndpointEnabled={onToggleEndpointEnabled}
			/>

			{showPagination ? (
				<div className="flex flex-wrap items-center justify-end gap-3">
					<span className="text-muted-foreground text-sm tabular-nums">
						{pageLabel}
					</span>
					<div className="flex items-center gap-2">
						<Button
							disabled={!hasPreviousPage || isFetchingPage}
							onClick={onPreviousPage}
							type="button"
							variant="outline"
						>
							Previous
						</Button>
						<Button
							disabled={!hasNextPage || isFetchingPage}
							onClick={onNextPage}
							type="button"
							variant="outline"
						>
							{isFetchingPage ? "Loading..." : "Next"}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}
