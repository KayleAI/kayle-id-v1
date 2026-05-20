import { Button } from "@kayle-id/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type {
	WebhookDelivery,
	WebhookEndpoint,
	WebhookEventDelivery,
} from "@/app/webhooks/api";
import {
	getWebhookDeliveryPayloadLabel,
	getWebhookDeliveryRetryDisabledReason,
} from "@/app/webhooks/utils";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { RelativeTime } from "@/components/relative-time";
import {
	LoadingState,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
	showAsyncToast,
} from "../shared";

type DeliveriesTabContentBaseProps = {
	endpointsById?: Record<string, WebhookEndpoint>;
	error: unknown;
	isLoading: boolean;
	isRetrying: boolean;
	onRetryDelivery: (deliveryId: string) => Promise<void>;
};

type DeliveriesTabContentProps =
	| (DeliveriesTabContentBaseProps & {
			context: "endpoint";
			deliveries: WebhookDelivery[];
	  })
	| (DeliveriesTabContentBaseProps & {
			context: "event";
			deliveries: WebhookEventDelivery[];
	  });

function DeliveryRetryButton({
	deliveryId,
	isDisabled,
	onRetryDelivery,
}: {
	deliveryId: string;
	isDisabled: boolean;
	onRetryDelivery: (deliveryId: string) => Promise<void>;
}) {
	return (
		<Button
			disabled={isDisabled}
			onClick={() =>
				showAsyncToast(onRetryDelivery(deliveryId), {
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
	);
}

export function DeliveriesTabContent(props: DeliveriesTabContentProps) {
	let content: ReactNode;

	if (props.isLoading) {
		content = <LoadingState />;
	} else if (props.deliveries.length === 0) {
		content = (
			<SectionMessage
				description={
					props.context === "event"
						? "Delivery attempts for this event will appear here once endpoints begin receiving it."
						: "Delivery attempts for this endpoint will appear here after events are queued."
				}
				title={
					props.context === "event"
						? "No deliveries queued yet"
						: "No deliveries yet"
				}
			/>
		);
	} else if (props.context === "event") {
		content = (
			<div className="overflow-x-auto rounded-md border border-border/70">
				<Table className="min-w-[48rem] table-fixed">
					<colgroup>
						<col className="w-[46%]" />
						<col className="w-[12%]" />
						<col className="w-[8%]" />
						<col className="w-[10%]" />
						<col className="w-[14%]" />
						<col className="w-[10%]" />
					</colgroup>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Endpoint</TableHead>
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
						{props.deliveries.map((delivery) => {
							const endpoint =
								props.endpointsById?.[delivery.webhook_endpoint_id];
							const endpointName = endpoint?.name?.trim();

							return (
								<TableRow key={delivery.id}>
									<TableCell className="align-middle">
										{endpoint ? (
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
										) : (
											<div
												className="font-medium text-sm"
												title={delivery.webhook_endpoint_id}
											>
												Endpoint unavailable
											</div>
										)}
									</TableCell>
									<TableCell className="align-middle">
										<StatusBadge status={delivery.status} />
									</TableCell>
									<TableCell className="align-middle text-sm tabular-nums">
										{delivery.attempt_count}
									</TableCell>
									<TableCell className="align-middle">
										<ResponseCodeBadge statusCode={delivery.last_status_code} />
									</TableCell>
									<TableCell className="align-middle text-muted-foreground text-sm tabular-nums">
										{delivery.last_attempt_at ? (
											<RelativeTime iso={delivery.last_attempt_at} />
										) : (
											"Never"
										)}
									</TableCell>
									<TableCell className="align-middle text-right">
										<DeliveryRetryButton
											deliveryId={delivery.id}
											isDisabled={
												props.isRetrying ||
												getWebhookDeliveryRetryDisabledReason(delivery) !== null
											}
											onRetryDelivery={props.onRetryDelivery}
										/>
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</div>
		);
	} else {
		content = (
			<div className="overflow-x-auto rounded-md border border-border/70">
				<Table>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Delivery</TableHead>
							<TableHead>Event</TableHead>
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
						{props.deliveries.map((delivery) => (
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
									<DeliveryRetryButton
										deliveryId={delivery.id}
										isDisabled={
											props.isRetrying ||
											getWebhookDeliveryRetryDisabledReason(delivery) !== null
										}
										onRetryDelivery={props.onRetryDelivery}
									/>
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
				error={props.error}
				fallback={
					props.context === "event"
						? "Webhook endpoint details could not be loaded."
						: "Webhook deliveries could not be loaded."
				}
				title={
					props.context === "event"
						? "Failed to load endpoint details"
						: "Failed to load deliveries"
				}
			/>
			{content}
		</div>
	);
}
