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
import type { WebhookEvent } from "@/app/webhooks/api";
import {
	getEventTriggerLabel,
	getSuccessfulDeliveryFraction,
} from "@/app/webhooks/utils";
import { RelativeTime } from "@/components/relative-time";
import { LoadingState, QueryErrorAlert, SectionMessage } from "../shared";

export function EventsTabContent({
	error,
	events,
	hasNextPage,
	isFetchingNextPage,
	isLoading,
	onLoadMore,
}: {
	error: unknown;
	events: WebhookEvent[];
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
	isLoading: boolean;
	onLoadMore: () => void;
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
			<div className="overflow-x-auto rounded-md border border-border/70">
				<Table className="w-full min-w-[760px] table-fixed">
					<colgroup>
						<col className="w-[58%]" />
						<col className="w-[28%]" />
						<col className="w-[14%]" />
					</colgroup>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Event</TableHead>
							<TableHead>Successful deliveries</TableHead>
							<TableHead>Created</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{events.map((event) => (
							<TableRow key={event.id}>
								<TableCell className="align-middle">
									<div className="min-w-0 space-y-1">
										<Link
											className="block truncate font-medium transition-colors hover:text-foreground/80 hover:underline"
											params={{ event: event.id }}
											search={{ tab: "events" }}
											to="/webhooks/events/$event"
										>
											{event.type}
										</Link>
										<div className="truncate text-muted-foreground text-xs capitalize">
											{getEventTriggerLabel(event)}
										</div>
									</div>
								</TableCell>
								<TableCell className="align-middle">
									<span className="font-medium text-sm tabular-nums">
										{getSuccessfulDeliveryFraction(event.deliveries)}
									</span>
								</TableCell>
								<TableCell className="align-middle">
									<div className="truncate text-muted-foreground text-sm tabular-nums">
										<RelativeTime iso={event.created_at} />
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
			{hasNextPage ? (
				<div className="flex justify-center">
					<Button
						disabled={isFetchingNextPage}
						onClick={onLoadMore}
						type="button"
						variant="outline"
					>
						{isFetchingNextPage ? "Loading..." : "Load more"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
