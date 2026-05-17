import { Button } from "@kayleai/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { WebhookDelivery, WebhookEndpoint } from "@/app/webhooks/api";
import {
	getEndpointDisplayName,
	getEndpointSecondaryLabel,
	getWebhookDeliveryPayloadLabel,
	getWebhookDeliveryRetryDisabledReason,
} from "@/app/webhooks/utils";
import { RelativeTime } from "@/components/relative-time";
import {
	LoadingState,
	QueryErrorAlert,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
	showAsyncToast,
} from "../shared";

export function DeliveriesTabContent({
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
							<TableHead>Payload</TableHead>
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
									<TableCell className="min-w-[12rem]">
										<div className="space-y-1 text-sm">
											<div>{getWebhookDeliveryPayloadLabel(delivery)}</div>
											{delivery.payload_expires_at ? (
												<div className="text-muted-foreground text-xs">
													Expires{" "}
													<RelativeTime iso={delivery.payload_expires_at} />
												</div>
											) : null}
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm tabular-nums">
										{delivery.last_attempt_at ? (
											<RelativeTime iso={delivery.last_attempt_at} />
										) : (
											"Never"
										)}
									</TableCell>
									<TableCell className="text-right">
										<Button
											disabled={
												isRetrying ||
												getWebhookDeliveryRetryDisabledReason(delivery) !== null
											}
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
