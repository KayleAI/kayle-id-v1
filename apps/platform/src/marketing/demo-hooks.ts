import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
} from "react";
import type { DemoRunView } from "@/demo/types";
import {
	getDemoWebhookHistory,
	getDemoWebhookReceiptId,
	getDemoWebhookReplayReceiptIds,
} from "@/demo/webhook-history";
import { getDemoRun, processWebhookReceipt } from "@/marketing/demo-api";
import type { ProcessedWebhookMap } from "@/marketing/demo-attempts";
import { getErrorMessage } from "@/utils/get-error-message";

const POLL_INTERVAL_MS = 2000;

export type DemoStepId = "step-1" | "step-2" | "step-3";

export function getDemoStepSectionId(stepId: DemoStepId): string {
	return `demo-${stepId}`;
}

export function useDemoRunInitialization({
	handleGenerateRun,
	hasInitializedRun,
	setHasInitializedRun,
}: {
	handleGenerateRun: () => void;
	hasInitializedRun: boolean;
	setHasInitializedRun: (value: boolean) => void;
}) {
	useEffect(() => {
		if (hasInitializedRun) {
			return;
		}

		setHasInitializedRun(true);
		handleGenerateRun();
	}, [handleGenerateRun, hasInitializedRun, setHasInitializedRun]);
}

export function useDemoStepProgression({
	canReviewOutcome,
	hasSession,
	onOpenStepChange,
}: {
	canReviewOutcome: boolean;
	hasSession: boolean;
	onOpenStepChange: (step: DemoStepId) => void;
}) {
	const previousHasSessionRef = useRef(false);
	const previousCanReviewOutcomeRef = useRef(false);

	useEffect(() => {
		if (!hasSession) {
			previousHasSessionRef.current = false;
			previousCanReviewOutcomeRef.current = false;
			onOpenStepChange("step-1");
			return;
		}

		if (!previousHasSessionRef.current) {
			onOpenStepChange("step-2");
		}

		if (canReviewOutcome && !previousCanReviewOutcomeRef.current) {
			onOpenStepChange("step-3");
		}

		previousHasSessionRef.current = hasSession;
		previousCanReviewOutcomeRef.current = canReviewOutcome;
	}, [canReviewOutcome, hasSession, onOpenStepChange]);
}

export function useDemoStepScroll({ openStep }: { openStep: DemoStepId }) {
	const hasMountedRef = useRef(false);

	useEffect(() => {
		if (!hasMountedRef.current) {
			hasMountedRef.current = true;
			return;
		}

		// Auto-scroll only matters on small viewports where the demo panels don't
		// all fit on screen. On lg+ screens every panel is visible at once, so
		// scrolling on step changes just yanks the user away from where they were.
		if (window.matchMedia("(min-width: 1024px)").matches) {
			return;
		}

		const panel = document.getElementById(getDemoStepSectionId(openStep));
		if (!panel) {
			return;
		}

		const prefersReducedMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;

		const frameId = window.requestAnimationFrame(() => {
			panel.scrollIntoView({
				behavior: prefersReducedMotion ? "auto" : "smooth",
				block: "start",
			});
		});

		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [openStep]);
}

export function useDemoRunPolling({
	isRunSettled,
	onRunError,
	onRunLoaded,
	runId,
}: {
	isRunSettled: boolean;
	onRunError: (message: string) => void;
	onRunLoaded: (nextRun: DemoRunView) => void;
	runId: string | null;
}) {
	useEffect(() => {
		if (!(runId && !isRunSettled)) {
			return;
		}

		let cancelled = false;

		const poll = () => {
			getDemoRun(runId)
				.then((nextRun) => {
					if (!cancelled) {
						onRunLoaded(nextRun);
					}
				})
				.catch((error: unknown) => {
					if (!cancelled) {
						onRunError(getErrorMessage(error, "Failed to refresh demo run."));
					}
				});
		};

		poll();
		const interval = window.setInterval(poll, POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			window.clearInterval(interval);
		};
	}, [isRunSettled, onRunError, onRunLoaded, runId]);
}

export function useProcessedWebhookReceipts({
	onProcessedWebhooksChange,
	privateKey,
	processedWebhooks,
	run,
	signingSecret,
}: {
	onProcessedWebhooksChange: Dispatch<SetStateAction<ProcessedWebhookMap>>;
	privateKey: CryptoKey | null;
	processedWebhooks: ProcessedWebhookMap;
	run: DemoRunView | null;
	signingSecret: string | null;
}) {
	const processedReceiptIdsRef = useRef(new Set<string>());
	const webhookHistory = useMemo(() => getDemoWebhookHistory(run), [run]);
	const replayReceiptIds = useMemo(
		() => getDemoWebhookReplayReceiptIds(webhookHistory),
		[webhookHistory],
	);

	useEffect(() => {
		processedReceiptIdsRef.current = new Set(Object.keys(processedWebhooks));
	}, [processedWebhooks]);

	useEffect(() => {
		if (!(privateKey && signingSecret)) {
			return;
		}

		const unprocessedWebhooks = webhookHistory.filter(
			(webhook) =>
				!processedReceiptIdsRef.current.has(getDemoWebhookReceiptId(webhook)),
		);

		if (unprocessedWebhooks.length === 0) {
			return;
		}

		let cancelled = false;

		for (const webhook of unprocessedWebhooks) {
			processedReceiptIdsRef.current.add(getDemoWebhookReceiptId(webhook));
		}

		onProcessedWebhooksChange((current) => {
			const nextState = { ...current };

			for (const webhook of unprocessedWebhooks) {
				nextState[getDemoWebhookReceiptId(webhook)] = {
					decryptedPayload: null,
					error: null,
					status: "verified",
				};
			}

			return nextState;
		});

		Promise.all(
			unprocessedWebhooks.map(async (webhook) => ({
				receiptId: getDemoWebhookReceiptId(webhook),
				state: await processWebhookReceipt({
					isReplay: replayReceiptIds.has(getDemoWebhookReceiptId(webhook)),
					privateKey,
					secret: signingSecret,
					webhook,
				}),
			})),
		).then((results) => {
			if (cancelled) {
				return;
			}

			onProcessedWebhooksChange((current) => {
				const nextState = { ...current };

				for (const result of results) {
					nextState[result.receiptId] = result.state;
				}

				return nextState;
			});
		});

		return () => {
			cancelled = true;
		};
	}, [
		onProcessedWebhooksChange,
		privateKey,
		signingSecret,
		replayReceiptIds,
		webhookHistory,
	]);
}
