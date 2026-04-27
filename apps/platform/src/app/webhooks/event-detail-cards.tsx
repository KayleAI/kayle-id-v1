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
import { Loader2Icon } from "lucide-react";
import type { ReactNode } from "react";
import { formatDate } from "@/utils/format-date";
import type { WebhookEndpoint, WebhookEvent } from "./api";
import {
	QueryErrorAlert,
	ResponseCodeBadge,
	SectionMessage,
	StatusBadge,
	showAsyncToast,
} from "./shared";
import {
	formatCount,
	formatOptionalDate,
	getAttachedEndpointIds,
	getEndpointDisplayName,
	getEndpointSecondaryLabel,
	getEventTriggerLabel,
	getWebhookEventReplayDisabledReason,
} from "./utils";

export function EventAttachedEndpointsCard({
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

export function EventOverviewCard({
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
