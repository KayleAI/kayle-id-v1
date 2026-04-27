import { SUPPORTED_WEBHOOK_EVENT_TYPES } from "@kayle-id/config/webhook-events";
import { Button } from "@kayleai/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kayleai/ui/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";
import type { WebhookEvent } from "./api";
import {
	formatCountLabel,
	getEventSubscriptionSummary,
	getWebhookEventTypeDescription,
} from "./utils";

export function EventDeliverySummary({
	deliveries,
}: {
	deliveries: WebhookEvent["deliveries"];
}) {
	if (deliveries.length === 0) {
		return <p className="text-muted-foreground text-sm">No deliveries</p>;
	}

	const failedCount = deliveries.filter(
		(delivery) => delivery.status === "failed",
	).length;
	const inFlightCount = deliveries.filter(
		(delivery) =>
			delivery.status === "pending" || delivery.status === "delivering",
	).length;
	const endpointCount = new Set(
		deliveries.map((delivery) => delivery.webhook_endpoint_id),
	).size;

	let secondaryLabel = formatCountLabel(deliveries.length, "delivery");

	if (failedCount > 0) {
		secondaryLabel = formatCountLabel(failedCount, "failure");
	} else if (inFlightCount > 0) {
		secondaryLabel = formatCountLabel(
			inFlightCount,
			"in-flight attempt",
			"in-flight attempts",
		);
	}

	return (
		<div className="space-y-1">
			<p className="text-sm tabular-nums">
				{formatCountLabel(endpointCount, "endpoint")}
			</p>
			<p className="truncate text-muted-foreground text-xs">{secondaryLabel}</p>
		</div>
	);
}

export function EventSubscriptionMenu({
	selectedEventTypes,
	onToggleEventType,
}: {
	selectedEventTypes: string[];
	onToggleEventType: (eventType: string) => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						className="h-auto min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left"
						type="button"
						variant="outline"
					>
						<div className="min-w-0 font-normal text-sm">
							{getEventSubscriptionSummary(selectedEventTypes)}
						</div>
						<ChevronDownIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					</Button>
				}
			/>
			<DropdownMenuContent
				align="start"
				className="w-96 max-w-[calc(100vw-3rem)] rounded-sm!"
			>
				<DropdownMenuGroup>
					<DropdownMenuLabel>Event subscriptions</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{SUPPORTED_WEBHOOK_EVENT_TYPES.map((eventType) => (
						<DropdownMenuCheckboxItem
							checked={selectedEventTypes.includes(eventType)}
							className="items-start py-2.5"
							closeOnClick={false}
							key={eventType}
							onCheckedChange={() => onToggleEventType(eventType)}
						>
							<div className="min-w-0 space-y-1 pr-4">
								<div className="font-mono text-sm">{eventType}</div>
								<p className="text-muted-foreground text-xs">
									{getWebhookEventTypeDescription(eventType)}
								</p>
							</div>
						</DropdownMenuCheckboxItem>
					))}
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
