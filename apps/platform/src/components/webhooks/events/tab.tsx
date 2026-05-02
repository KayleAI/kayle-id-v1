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
import type { WebhookEvent } from "@/app/webhooks/api";
import { getEventTriggerLabel } from "@/app/webhooks/utils";
import { formatDate } from "@/utils/format-date";
import { LoadingState, QueryErrorAlert, SectionMessage } from "../shared";
import { EventDeliverySummary } from "./pieces";

export function EventsTabContent({
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
