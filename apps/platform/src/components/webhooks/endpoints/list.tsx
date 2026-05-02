import { Button } from "@kayleai/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayleai/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { TabsList, TabsTrigger } from "@kayleai/ui/tabs";
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
	formatOptionalDate,
	getEndpointDisplayName,
	getEndpointSecondaryLabel,
	getEventSubscriptionSummary,
	TAB_OPTIONS,
} from "@/app/webhooks/utils";
import {
	QueryErrorAlert,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
} from "../shared";

export function WebhooksToolbar() {
	return (
		<div className="flex flex-col gap-4 border-border/70 border-b pb-4 lg:flex-row lg:items-center lg:justify-between">
			<TabsList
				className="h-auto w-full justify-start gap-5 rounded-none bg-transparent p-0"
				variant="line"
			>
				{TAB_OPTIONS.map((tab) => (
					<TabsTrigger
						className="h-10 flex-none rounded-none px-0 pb-2 data-active:bg-transparent"
						key={tab.value}
						value={tab.value}
					>
						{tab.label}
					</TabsTrigger>
				))}
			</TabsList>
		</div>
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
			<Table className="w-full table-fixed">
				<TableHeader className="bg-muted/30">
					<TableRow>
						<TableHead>Destination</TableHead>
						<TableHead>Listening to</TableHead>
						<TableHead>Status</TableHead>
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

						return (
							<TableRow key={endpoint.id}>
								<TableCell className="w-[42%]">
									<div className="min-w-0 space-y-0.5">
										<Link
											className="block truncate font-medium transition-colors hover:text-foreground/80 hover:underline"
											params={{ endpoint: endpoint.id }}
											to="/webhooks/$endpoint"
										>
											{getEndpointDisplayName(endpoint)}
										</Link>
										<div className="truncate text-muted-foreground text-xs">
											{getEndpointSecondaryLabel(endpoint)}
										</div>
									</div>
								</TableCell>
								<TableCell className="w-[24%]">
									<div className="font-medium text-sm">
										{getEventSubscriptionSummary(
											endpoint.subscribed_event_types,
										)}
									</div>
								</TableCell>
								<TableCell className="w-[14%]">
									<StatusBadge
										status={endpoint.enabled ? "active" : "disabled"}
									/>
								</TableCell>
								<TableCell className="w-[16%]">
									<div className="flex items-center gap-2">
										<div className="truncate text-muted-foreground text-sm tabular-nums">
											{formatOptionalDate(deliveryStats.lastAttemptAt)}
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
	isMutatingEndpointId,
	onDeleteEndpoint,
	onToggleEndpointEnabled,
}: {
	deliveryStatsByEndpoint: Record<string, EndpointDeliveryStats>;
	endpointError: unknown;
	endpoints: WebhookEndpoint[];
	isMutatingEndpointId: string | null;
	onDeleteEndpoint: (endpoint: WebhookEndpoint) => Promise<void>;
	onToggleEndpointEnabled: (endpoint: WebhookEndpoint) => Promise<void>;
}) {
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
		</div>
	);
}
