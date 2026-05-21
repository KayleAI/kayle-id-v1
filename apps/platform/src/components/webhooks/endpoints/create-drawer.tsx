import {
	DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
	SUPPORTED_WEBHOOK_EVENT_TYPES,
} from "@kayle-id/config/webhook-events";
import { Button } from "@kayle-id/ui/components/button";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import {
	Sheet,
	SheetContent,
	SheetTitle,
	SheetTrigger,
} from "@kayle-id/ui/components/sheet";
import { Switch } from "@kayle-id/ui/components/switch";
import { cn } from "@kayle-id/ui/lib/utils";
import { ChevronDownIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type CreateEndpointSubmission,
	type CreateEndpointSubmissionResult,
	getCreateEndpointInitialPublicKey,
	parseEndpointLabels,
	toggleEventSelection,
	WEBHOOK_PAYLOAD_RETENTION_OPTIONS,
} from "@/app/webhooks/utils";
import { FormErrorAlert } from "@/components/form-error-alert";
import { getErrorMessage } from "@/utils/get-error-message";
import { EventSubscriptionMenu } from "../events/pieces";
import { PublicKeyFields } from "../keys/fields";

export function CreateEndpointDrawer({
	onSubmit,
}: {
	onSubmit: (
		input: CreateEndpointSubmission,
	) => Promise<CreateEndpointSubmissionResult>;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState(false);
	const [enabled, setEnabled] = useState(true);
	const [labelsInput, setLabelsInput] = useState("");
	const [name, setName] = useState("");
	const [
		undeliveredPayloadRetentionHours,
		setUndeliveredPayloadRetentionHours,
	] = useState(DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS);
	const [selectedEventTypes, setSelectedEventTypes] = useState<string[]>([
		...SUPPORTED_WEBHOOK_EVENT_TYPES,
	]);
	const [shouldConfigurePublicKey, setShouldConfigurePublicKey] =
		useState(false);
	const [publicKeyId, setPublicKeyId] = useState("");
	const [publicKeyInput, setPublicKeyInput] = useState("");
	const [url, setUrl] = useState("");
	const [errorMessage, setErrorMessage] = useState("");

	function resetState() {
		setIsSubmitting(false);
		setIsMoreOptionsOpen(false);
		setEnabled(true);
		setLabelsInput("");
		setName("");
		setUndeliveredPayloadRetentionHours(
			DEFAULT_UNDELIVERED_WEBHOOK_PAYLOAD_RETENTION_HOURS,
		);
		setSelectedEventTypes([...SUPPORTED_WEBHOOK_EVENT_TYPES]);
		setShouldConfigurePublicKey(false);
		setPublicKeyId("");
		setPublicKeyInput("");
		setUrl("");
		setErrorMessage("");
	}

	async function handleSubmit() {
		setErrorMessage("");

		try {
			if (!url.trim()) {
				throw new Error("Webhook URL is required.");
			}

			if (selectedEventTypes.length === 0) {
				throw new Error("Select at least one event type.");
			}

			setIsSubmitting(true);
			const result = await onSubmit({
				enabled,
				initialPublicKey: await getCreateEndpointInitialPublicKey({
					publicKeyId,
					publicKeyInput,
					shouldConfigurePublicKey,
				}),
				labels: parseEndpointLabels(labelsInput),
				name: name.trim() || null,
				subscribedEventTypes: selectedEventTypes,
				undeliveredPayloadRetentionHours,
				url: url.trim(),
			});

			setIsOpen(false);
			toast.success("Webhook endpoint created");

			if (result.publicKeyError) {
				toast.error(result.publicKeyError);
			}
		} catch (error) {
			setErrorMessage(
				getErrorMessage(error, "Failed to create webhook endpoint."),
			);
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<Sheet
			onOpenChange={setIsOpen}
			onOpenChangeComplete={(open) => {
				if (!open) {
					resetState();
				}
			}}
			open={isOpen}
		>
			<SheetTrigger
				render={
					<Button
						aria-label="Create webhook endpoint"
						className="w-9 px-0 sm:w-auto sm:px-3"
						onClick={() => setIsOpen(true)}
						variant="outline"
					>
						<PlusIcon aria-hidden className="size-4" />
						<span className="hidden sm:inline">Create endpoint</span>
					</Button>
				}
			/>
			<SheetContent
				className="flex w-full flex-col overflow-hidden sm:max-w-2xl"
				side="right"
			>
				<div className="border-border/70 border-b px-6 py-5">
					<SheetTitle>Create webhook endpoint</SheetTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						Configure the destination, subscribed events, and active encryption
						key from one surface.
					</p>
				</div>

				<div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
					<FormErrorAlert
						message={errorMessage}
						title="Failed to create endpoint"
					/>

					<div className="space-y-2">
						<Label htmlFor="create-webhook-name">Endpoint name</Label>
						<Input
							id="create-webhook-name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Primary production webhook"
							value={name}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="create-webhook-labels">Labels</Label>
						<Input
							id="create-webhook-labels"
							onChange={(event) => setLabelsInput(event.target.value)}
							placeholder="production, identity"
							value={labelsInput}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="create-webhook-url">Destination URL</Label>
						<Input
							id="create-webhook-url"
							inputMode="url"
							onChange={(event) => {
								setUrl(event.target.value);
								setErrorMessage("");
							}}
							placeholder="https://example.com/webhooks/kayle"
							value={url}
						/>
					</div>

					<div className="space-y-2">
						<Label>Event subscriptions</Label>
						<EventSubscriptionMenu
							onToggleEventType={(eventType) =>
								setSelectedEventTypes((currentValue) =>
									toggleEventSelection(currentValue, eventType),
								)
							}
							selectedEventTypes={selectedEventTypes}
						/>
					</div>

					<div className="overflow-hidden rounded-md border border-border/70">
						<button
							aria-controls="create-endpoint-more-options"
							aria-expanded={isMoreOptionsOpen}
							className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
							onClick={() =>
								setIsMoreOptionsOpen((currentValue) => !currentValue)
							}
							type="button"
						>
							<div className="space-y-0.5">
								<div className="font-medium text-sm">More options</div>
								<p className="text-muted-foreground text-sm">
									Enabled state and initial public key configuration.
								</p>
							</div>
							<ChevronDownIcon
								className={cn(
									"size-4 shrink-0 text-muted-foreground transition-transform",
									isMoreOptionsOpen ? "rotate-180" : undefined,
								)}
							/>
						</button>

						{isMoreOptionsOpen ? (
							<div
								className="space-y-4 border-border/70 border-t px-4 py-4"
								id="create-endpoint-more-options"
							>
								<div className="flex items-center justify-between gap-6">
									<div className="space-y-0.5">
										<Label htmlFor="create-endpoint-enabled">Enabled</Label>
										<p className="text-muted-foreground text-sm">
											Start receiving deliveries immediately after creation.
										</p>
									</div>
									<Switch
										checked={enabled}
										id="create-endpoint-enabled"
										onCheckedChange={setEnabled}
									/>
								</div>

								<div className="space-y-3 border-border/70 border-t pt-4">
									<div className="space-y-1">
										<Label>Undelivered payload retention</Label>
										<p className="text-muted-foreground text-sm">
											Delivered payloads are scrubbed immediately. This setting
											only controls encrypted payloads after final delivery
											failure.
										</p>
									</div>
									<div className="grid gap-2 sm:grid-cols-2">
										{WEBHOOK_PAYLOAD_RETENTION_OPTIONS.map((option) => (
											<button
												aria-pressed={
													undeliveredPayloadRetentionHours === option.value
												}
												className="rounded-md border border-border/70 px-3 py-2 text-left text-sm transition-colors hover:border-foreground/30 aria-pressed:border-foreground aria-pressed:bg-muted"
												key={option.value}
												onClick={() =>
													setUndeliveredPayloadRetentionHours(option.value)
												}
												type="button"
											>
												<span className="block font-medium">
													{option.label}
												</span>
												<span className="mt-1 block text-muted-foreground text-xs">
													{option.description}
												</span>
											</button>
										))}
									</div>
								</div>

								<div className="space-y-3 border-border/70 border-t pt-4">
									<div className="flex items-center justify-between gap-6">
										<div className="space-y-0.5">
											<Label htmlFor="create-endpoint-public-key">
												Configure public key
											</Label>
											<p className="text-muted-foreground text-sm">
												Add the initial active encryption key now so new
												deliveries do not fail for missing key material.
											</p>
										</div>
										<Switch
											checked={shouldConfigurePublicKey}
											id="create-endpoint-public-key"
											onCheckedChange={setShouldConfigurePublicKey}
										/>
									</div>

									{shouldConfigurePublicKey ? (
										<PublicKeyFields
											jwkInput={publicKeyInput}
											jwkInputId="create-endpoint-jwk"
											keyId={publicKeyId}
											keyIdId="create-endpoint-key-id"
											onJwkInputChange={(value) => {
												setPublicKeyInput(value);
												setErrorMessage("");
											}}
											onKeyIdChange={setPublicKeyId}
										/>
									) : null}
								</div>
							</div>
						) : null}
					</div>
				</div>

				<div className="flex items-center justify-end gap-3 border-border/70 border-t px-6 py-4">
					<Button
						onClick={() => setIsOpen(false)}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={isSubmitting} onClick={handleSubmit} type="button">
						{isSubmitting ? (
							<Loader2Icon className="mr-2 size-4 animate-spin" />
						) : null}
						Create endpoint
					</Button>
				</div>
			</SheetContent>
		</Sheet>
	);
}
