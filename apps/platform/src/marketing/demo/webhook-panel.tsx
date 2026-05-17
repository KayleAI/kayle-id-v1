import { Button } from "@kayleai/ui/button";
import { cn } from "@kayleai/ui/utils/cn";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DemoRunView, DemoWebhookEnvelope } from "@/demo/types";
import {
	getDemoWebhookHistory,
	getDemoWebhookReceiptId,
	getLatestDemoWebhook,
} from "@/demo/webhook-history";
import {
	formatStatusLabel,
	getDemoProgressLabel,
} from "@/marketing/demo/progress";
import {
	buildDemoAttemptViews,
	defaultProcessedWebhookState,
	type ProcessedWebhookMap,
	type ProcessedWebhookState,
} from "@/marketing/demo-attempts";
import {
	buildDemoDocumentPreview,
	buildDemoWebhookEventPreview,
} from "@/marketing/demo-document";
import {
	DemoAgePreviewPanel,
	DemoDocumentPreviewPanel,
	DemoWebhookEventPreviewPanel,
} from "@/marketing/demo-result-views";

function getWebhookPanelState({
	processedWebhook,
	run,
	selectedWebhook,
}: {
	processedWebhook: ProcessedWebhookState;
	run: DemoRunView | null;
	selectedWebhook: DemoWebhookEnvelope | null;
}): { description: string; title: string } | null {
	const sessionStatus = run?.session_status ?? null;

	if (!selectedWebhook) {
		return {
			title: sessionStatus?.is_terminal
				? "Waiting for the webhook"
				: "Waiting for the check result",
			description: sessionStatus?.is_terminal
				? "This run has ended. Waiting for the final webhook delivery to arrive."
				: "Finish the Kayle check on mobile and the result will appear here.",
		};
	}

	if (processedWebhook.status === "verified") {
		return {
			title: "Preparing the result",
			description:
				"Checking the signature and decrypting the webhook payload locally in this browser.",
		};
	}

	if (!processedWebhook.decryptedPayload) {
		return {
			title: "Preparing the result",
			description: "Waiting for the webhook payload to finish decrypting.",
		};
	}

	return {
		title:
			selectedWebhook.event_type === "verification.attempt.succeeded"
				? "Document unavailable"
				: "Webhook event unavailable",
		description: "The result arrived, but it could not be formatted cleanly.",
	};
}

function AttemptSelector({
	onSelectNext,
	onSelectPrevious,
	selectedIndex,
	total,
}: {
	onSelectNext: () => void;
	onSelectPrevious: () => void;
	selectedIndex: number;
	total: number;
}) {
	return (
		<div className="mb-6 flex flex-col gap-4 border-border/70 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<p className="font-medium text-foreground text-sm">Attempts</p>
				<p className="mt-1 text-muted-foreground text-sm leading-relaxed">
					Showing attempt {selectedIndex + 1} of {total}.
				</p>
			</div>

			<div className="flex items-center gap-2">
				<Button
					disabled={selectedIndex === 0}
					onClick={onSelectPrevious}
					size="sm"
					type="button"
					variant="outline"
				>
					<ChevronLeftIcon className="mr-1 size-4" />
					Previous
				</Button>
				<Button
					disabled={selectedIndex >= total - 1}
					onClick={onSelectNext}
					size="sm"
					type="button"
					variant="outline"
				>
					Next
					<ChevronRightIcon className="ml-1 size-4" />
				</Button>
			</div>
		</div>
	);
}

function WebhookResultSummary({
	documentPreview,
	eventPreview,
	hasDetails,
	processedWebhook,
	run,
	selectedWebhook,
	state,
}: {
	documentPreview: ReturnType<typeof buildDemoDocumentPreview>;
	eventPreview: ReturnType<typeof buildDemoWebhookEventPreview>;
	hasDetails: boolean;
	processedWebhook: ProcessedWebhookState;
	run: DemoRunView | null;
	selectedWebhook: DemoWebhookEnvelope | null;
	state: { description: string; title: string } | null;
}) {
	const eventLabel = selectedWebhook?.event_type
		? formatStatusLabel(selectedWebhook.event_type.replaceAll(".", " "))
		: null;
	const progressLabel = getDemoProgressLabel(run);
	const summary = (() => {
		if (documentPreview) {
			return {
				description:
					"The webhook signature was checked, decrypted locally, and mapped into the selected document fields below.",
				title: "Confirmed document signal",
			};
		}

		if (eventPreview) {
			return {
				description: eventPreview.description,
				title: eventPreview.title,
			};
		}

		if (processedWebhook.error) {
			return {
				description: processedWebhook.error,
				title: "Local webhook validation failed",
			};
		}

		return (
			state ?? {
				description:
					"The webhook payload has been checked and decrypted locally in this browser.",
				title: "Result ready",
			}
		);
	})();

	return (
		<div className={cn(hasDetails && "mb-6 border-border/70 border-b pb-6")}>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h3 className="max-w-[22ch] text-balance font-medium text-foreground text-xl tracking-tight">
						{summary.title}
					</h3>
					<p className="mt-2 max-w-[52ch] text-muted-foreground text-sm leading-6">
						{summary.description}
					</p>
					{eventLabel ? null : (
						<p className="mt-4 text-muted-foreground text-sm">
							{progressLabel}
						</p>
					)}
				</div>
				{eventLabel ? (
					<p className="shrink-0 font-mono text-muted-foreground text-xs">
						{eventLabel}
					</p>
				) : null}
			</div>
		</div>
	);
}

export function WebhookPanel({
	mode = "document",
	processedWebhooks,
	run,
}: {
	mode?: "age" | "document";
	processedWebhooks: ProcessedWebhookMap;
	run: DemoRunView | null;
}) {
	const webhookHistory = useMemo(() => getDemoWebhookHistory(run), [run]);
	const latestWebhook = useMemo(() => getLatestDemoWebhook(run), [run]);
	const attemptViews = useMemo(
		() =>
			buildDemoAttemptViews({
				processedWebhooks,
				webhooks: webhookHistory,
			}),
		[processedWebhooks, webhookHistory],
	);
	const latestAttemptId = attemptViews.at(-1)?.id ?? null;
	const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(
		latestAttemptId,
	);

	useEffect(() => {
		setSelectedAttemptId(latestAttemptId);
	}, [latestAttemptId]);

	const selectedAttempt = useMemo(
		() =>
			attemptViews.find((attempt) => attempt.id === selectedAttemptId) ??
			attemptViews.at(-1) ??
			null,
		[attemptViews, selectedAttemptId],
	);
	const selectedAttemptIndex = selectedAttempt
		? attemptViews.findIndex((attempt) => attempt.id === selectedAttempt.id)
		: -1;
	const selectedWebhook = selectedAttempt?.webhook ?? latestWebhook;
	const processedWebhook = selectedAttempt
		? selectedAttempt.processedWebhook
		: selectedWebhook
			? (processedWebhooks[getDemoWebhookReceiptId(selectedWebhook)] ??
				defaultProcessedWebhookState)
			: defaultProcessedWebhookState;
	const documentPreview = useMemo(
		() => buildDemoDocumentPreview(processedWebhook.decryptedPayload),
		[processedWebhook.decryptedPayload],
	);
	const eventPreview = useMemo(
		() => buildDemoWebhookEventPreview(processedWebhook.decryptedPayload),
		[processedWebhook.decryptedPayload],
	);
	const state = useMemo(
		() =>
			getWebhookPanelState({
				processedWebhook,
				run,
				selectedWebhook,
			}),
		[processedWebhook, run, selectedWebhook],
	);
	const content = (() => {
		if (documentPreview) {
			if (mode === "age") {
				return (
					<DemoAgePreviewPanel
						payload={processedWebhook.decryptedPayload ?? ""}
						preview={documentPreview}
					/>
				);
			}

			return (
				<DemoDocumentPreviewPanel
					payload={processedWebhook.decryptedPayload ?? ""}
					preview={documentPreview}
				/>
			);
		}

		if (eventPreview && processedWebhook.decryptedPayload) {
			return (
				<DemoWebhookEventPreviewPanel
					payload={processedWebhook.decryptedPayload}
					preview={eventPreview}
				/>
			);
		}

		return null;
	})();

	return (
		<>
			{mode === "document" && !(documentPreview || eventPreview) ? (
				<WebhookResultSummary
					hasDetails={content !== null}
					documentPreview={documentPreview}
					eventPreview={eventPreview}
					processedWebhook={processedWebhook}
					run={run}
					selectedWebhook={selectedWebhook}
					state={state}
				/>
			) : null}
			{attemptViews.length > 1 && selectedAttemptIndex >= 0 ? (
				<AttemptSelector
					onSelectNext={() => {
						const nextAttempt = attemptViews[selectedAttemptIndex + 1];
						if (nextAttempt) {
							setSelectedAttemptId(nextAttempt.id);
						}
					}}
					onSelectPrevious={() => {
						const previousAttempt = attemptViews[selectedAttemptIndex - 1];
						if (previousAttempt) {
							setSelectedAttemptId(previousAttempt.id);
						}
					}}
					selectedIndex={selectedAttemptIndex}
					total={attemptViews.length}
				/>
			) : null}
			{content}
		</>
	);
}
