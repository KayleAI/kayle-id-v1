import { Button } from "@kayleai/ui/button";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@kayleai/ui/sheet";
import { Switch } from "@kayleai/ui/switch";
import { Loader2Icon } from "lucide-react";
import { useState } from "react";
import { WEBHOOK_PAYLOAD_RETENTION_OPTIONS } from "@/app/webhooks/utils";
import { EventSubscriptionMenu } from "../events/pieces";
import { showAsyncToast } from "../shared";

export function EditEndpointDrawer({
	endpointEnabled,
	endpointLabelsInput,
	endpointName,
	endpointSubscribedEventTypes,
	endpointUndeliveredPayloadRetentionHours,
	endpointUrl,
	isDirty,
	isSaving,
	onEndpointEnabledChange,
	onEndpointLabelsInputChange,
	onEndpointNameChange,
	onEndpointUndeliveredPayloadRetentionHoursChange,
	onToggleEndpointEventType,
	onEndpointUrlChange,
	onReset,
	onSaveEndpoint,
}: {
	endpointEnabled: boolean;
	endpointLabelsInput: string;
	endpointName: string;
	endpointSubscribedEventTypes: string[];
	endpointUndeliveredPayloadRetentionHours: number;
	endpointUrl: string;
	isDirty: boolean;
	isSaving: boolean;
	onEndpointEnabledChange: (enabled: boolean) => void;
	onEndpointLabelsInputChange: (value: string) => void;
	onEndpointNameChange: (value: string) => void;
	onEndpointUndeliveredPayloadRetentionHoursChange: (hours: number) => void;
	onToggleEndpointEventType: (eventType: string) => void;
	onEndpointUrlChange: (value: string) => void;
	onReset: () => void;
	onSaveEndpoint: () => Promise<void>;
}) {
	const [isOpen, setIsOpen] = useState(false);

	async function handleSaveAndClose(): Promise<void> {
		await onSaveEndpoint();
		setIsOpen(false);
	}

	return (
		<Sheet
			onOpenChange={setIsOpen}
			onOpenChangeComplete={(open) => {
				if (!open) {
					onReset();
				}
			}}
			open={isOpen}
		>
			<SheetTrigger
				render={
					<Button size="sm" type="button" variant="outline">
						Edit destination
					</Button>
				}
			/>
			<SheetContent
				className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
				side="right"
			>
				<div className="border-border/70 border-b px-6 py-5">
					<SheetTitle>Edit destination</SheetTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						Update the label, endpoint URL, event subscriptions, and delivery
						state.
					</p>
				</div>

				<div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
					<div className="space-y-2">
						<Label htmlFor="webhook-name">Endpoint name</Label>
						<Input
							className="h-11"
							id="webhook-name"
							onChange={(event) => onEndpointNameChange(event.target.value)}
							placeholder="Primary production webhook"
							value={endpointName}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="webhook-labels">Labels</Label>
						<Input
							className="h-11"
							id="webhook-labels"
							onChange={(event) =>
								onEndpointLabelsInputChange(event.target.value)
							}
							placeholder="production, identity"
							value={endpointLabelsInput}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="webhook-url">Destination URL</Label>
						<Input
							className="h-11"
							id="webhook-url"
							onChange={(event) => onEndpointUrlChange(event.target.value)}
							value={endpointUrl}
						/>
					</div>

					<div className="space-y-2">
						<Label>Event subscriptions</Label>
						<EventSubscriptionMenu
							onToggleEventType={onToggleEndpointEventType}
							selectedEventTypes={endpointSubscribedEventTypes}
						/>
					</div>

					<div className="space-y-3">
						<div className="space-y-1">
							<Label>Undelivered payload retention</Label>
							<p className="text-muted-foreground text-sm">
								Delivered payloads are scrubbed immediately. This setting only
								controls encrypted payloads after final delivery failure.
							</p>
						</div>
						<div className="grid gap-2 sm:grid-cols-2">
							{WEBHOOK_PAYLOAD_RETENTION_OPTIONS.map((option) => (
								<button
									aria-pressed={
										endpointUndeliveredPayloadRetentionHours === option.value
									}
									className="rounded-md border border-border/70 px-3 py-2 text-left text-sm transition-colors hover:border-foreground/30 aria-pressed:border-foreground aria-pressed:bg-muted"
									key={option.value}
									onClick={() =>
										onEndpointUndeliveredPayloadRetentionHoursChange(
											option.value,
										)
									}
									type="button"
								>
									<span className="block font-medium">{option.label}</span>
									<span className="mt-1 block text-muted-foreground text-xs">
										{option.description}
									</span>
								</button>
							))}
						</div>
					</div>

					<div className="flex items-start justify-between gap-6 rounded-md border border-border/70 px-4 py-3">
						<div className="space-y-1">
							<Label htmlFor="endpoint-enabled">Enabled</Label>
							<p className="text-muted-foreground text-xs">
								Allow this destination to receive new deliveries.
							</p>
						</div>
						<div className="pt-0.5">
							<Switch
								checked={endpointEnabled}
								id="endpoint-enabled"
								onCheckedChange={onEndpointEnabledChange}
							/>
						</div>
					</div>
				</div>

				<div className="flex justify-end border-border/70 border-t px-6 py-4">
					<Button
						disabled={!isDirty || isSaving}
						onClick={() =>
							showAsyncToast(handleSaveAndClose(), {
								loading: "Saving webhook endpoint...",
								success: "Webhook endpoint updated",
								error: "Failed to update webhook endpoint",
							})
						}
						type="button"
					>
						{isSaving ? (
							<Loader2Icon className="mr-2 size-4 animate-spin" />
						) : null}
						Save changes
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
