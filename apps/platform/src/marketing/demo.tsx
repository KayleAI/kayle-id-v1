import { minAgeThreshold } from "@kayle-id/config/share-claims";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { cn } from "@kayleai/ui/utils/cn";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	Loader2Icon,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import {
	buildRequestedShareFields,
	demoClaimSections,
	getClaimDescription,
	getModeLabel,
	initialFieldModes,
	isLockedDemoClaim,
} from "@/demo/claim-fields";
import { generateDemoKeyPair } from "@/demo/crypto";
import type {
	DemoFieldMode,
	DemoRunCreateResult,
	DemoRunView,
} from "@/demo/types";
import {
	getDemoWebhookHistory,
	getDemoWebhookReceiptId,
	getLatestDemoWebhook,
} from "@/demo/webhook-history";
import {
	createDemoRun,
	createDemoVerificationSession,
} from "@/marketing/demo-api";
import {
	buildDemoAttemptViews,
	defaultProcessedWebhookState,
	isDemoRunSettled,
	type ProcessedWebhookMap,
	type ProcessedWebhookState,
} from "@/marketing/demo-attempts";
import {
	buildDemoDocumentPreview,
	buildDemoWebhookEventPreview,
} from "@/marketing/demo-document";
import {
	type DemoStepId,
	getDemoStepSectionId,
	useDemoRunInitialization,
	useDemoRunPolling,
	useDemoStepProgression,
	useDemoStepScroll,
	useProcessedWebhookReceipts,
} from "@/marketing/demo-hooks";
import {
	buildWebhookMetadataItems,
	DemoDocumentPreviewPanel,
	DemoWebhookEventPreviewPanel,
	DocumentStatePanel,
} from "@/marketing/demo-result-views";

const _POLL_INTERVAL_MS = 2000;
const accordionPanelClass = "";

interface ModeSelectorProps {
	description?: string;
	disabled?: boolean;
	label: string;
	mode: DemoFieldMode;
	onChange: (mode: DemoFieldMode) => void;
}

interface DemoNoticeProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	title?: string;
}

type SelectionResult = ReturnType<typeof buildRequestedShareFields>;

function getModeButtonClass({
	active,
	option,
}: {
	active: boolean;
	option: DemoFieldMode;
}): string {
	if (!active) {
		return "text-neutral-600 hover:text-neutral-950";
	}

	if (option === "optional" || option === "required") {
		return "bg-neutral-900 text-white";
	}

	return "bg-white text-neutral-950";
}

function DemoNotice({ action, children, className, title }: DemoNoticeProps) {
	return (
		<div
			className={cn(
				"rounded-[1rem] border border-red-200/70 bg-red-50/40 px-4 py-3",
				className,
			)}
			role="alert"
		>
			<div className="flex items-start gap-3">
				<div className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500/90" />
				<div className="min-w-0 flex-1">
					{title ? (
						<p className="font-medium text-red-950 text-sm">{title}</p>
					) : null}
					<div
						className={cn(
							"text-sm leading-relaxed",
							title ? "mt-1 text-red-800/90" : "text-red-900/90",
						)}
					>
						{children}
					</div>
					{action ? <div className="mt-3">{action}</div> : null}
				</div>
			</div>
		</div>
	);
}

function createDemoRunView(createdRun: DemoRunCreateResult): DemoRunView {
	return {
		id: createdRun.demo_run_id,
		endpoint_id: createdRun.endpoint_id,
		key_id: `demo_${createdRun.demo_run_id}`,
		org_slug: createdRun.org_slug,
		session_id: null,
		session_status: null,
		share_fields: null,
		verification_url: null,
		webhook: null,
		webhooks: [],
	};
}

function DemoStepPanel({
	children,
	description,
	isLocked = false,
	isOpen,
	onOpen,
	stepId,
	stepNumber,
	title,
	className,
}: {
	children?: ReactNode;
	description: string;
	isLocked?: boolean;
	isOpen: boolean;
	onOpen?: () => void;
	stepId: DemoStepId;
	stepNumber: number;
	title: string;
	className?: string;
}) {
	const handleOpen = useCallback(
		(event: unknown) => {
			if (isLocked || isOpen) {
				return;
			}
			(event as React.MouseEvent<HTMLDivElement>).preventDefault();
			(event as React.MouseEvent<HTMLDivElement>).stopPropagation();

			onOpen?.();
		},
		[isLocked, isOpen, onOpen],
	);

	return (
		// biome-ignore lint/a11y: intentional
		<section
			className={cn(
				"scroll-mt-[180px] px-4 py-4 sm:scroll-mt-[240px] sm:px-5 sm:py-5",
				isLocked && "pointer-events-none blur-[2px]",
				className,
			)}
			id={getDemoStepSectionId(stepId)}
			onClick={handleOpen}
			onKeyDown={handleOpen}
			onKeyUp={handleOpen}
		>
			<div className="flex w-full flex-col items-start space-y-10">
				<div className="relative flex w-full flex-col items-start gap-2.5 sm:flex-row sm:gap-5">
					<div className="min-w-0 space-y-1.5">
						<h2 className="text-balance font-medium text-3xl tracking-tight">
							{stepNumber}. {title}
						</h2>
						<p className="max-w-3xl text-balance text-base text-neutral-600 leading-relaxed">
							{description}
						</p>
					</div>

					<hr className="w-full border-neutral-200/80 sm:hidden" />
				</div>

				{isOpen ? (
					<div className="w-full min-w-0 flex-1">
						<div className="w-full min-w-0">{children}</div>
					</div>
				) : null}
			</div>
		</section>
	);
}

function ModeSelector({
	description,
	label,
	mode,
	onChange,
	disabled = false,
}: ModeSelectorProps) {
	const options: DemoFieldMode[] = ["off", "optional", "required"];

	return (
		<div className="border-neutral-200/80 border-b py-4 sm:py-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 pr-0 sm:pr-6">
					<div className="font-medium text-base text-neutral-950">{label}</div>
					{description ? (
						<p className="max-w-xl text-neutral-500 text-sm leading-relaxed">
							{description}
						</p>
					) : null}
				</div>
				<div className="w-full sm:w-auto sm:shrink-0">
					{disabled ? (
						<div className="rounded-[1.25rem] border border-neutral-200/80 px-4 py-3 text-left sm:text-right">
							<div className="font-medium text-neutral-950 text-sm">
								Included automatically
							</div>
						</div>
					) : (
						<div className="grid min-h-12 w-full grid-cols-3 rounded-[1.25rem] border border-neutral-200 bg-neutral-100/90 p-1 sm:inline-flex sm:w-auto">
							{options.map((option) => {
								const active = option === mode;
								return (
									<button
										aria-pressed={active}
										className={cn(
											"min-h-10 w-full min-w-0 rounded-[1rem] px-3 font-medium text-sm transition-colors sm:w-24 sm:px-4",
											getModeButtonClass({ active, option }),
										)}
										key={option}
										onClick={() => onChange(option)}
										type="button"
									>
										{getModeLabel(option)}
									</button>
								);
							})}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function AgeGateSelector({
	errorMessage,
	thresholdText,
	onChange,
}: {
	errorMessage?: string | null;
	thresholdText: string;
	onChange: (value: string) => void;
}) {
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [isInputFocused, setIsInputFocused] = useState(false);
	const isOff = thresholdText.trim() === "";
	const isInputActive = isInputFocused || !isOff;
	const hasError = Boolean(errorMessage);
	let ageThresholdStateClassName = "text-neutral-600 hover:text-neutral-950";

	if (isInputActive) {
		ageThresholdStateClassName = hasError
			? "bg-white ring-1 ring-red-200"
			: "bg-white";
	}

	return (
		<div className="border-neutral-200/80 border-b py-4 sm:py-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 pr-0 sm:pr-6">
					<div className="font-medium text-base text-neutral-950">
						Minimum age
					</div>
					<p className="max-w-xl text-neutral-500 text-sm leading-relaxed">
						Entering `18` asks for an over-18 proof rather than the full date of
						birth.
					</p>
				</div>
				<div className="w-full sm:w-auto sm:shrink-0">
					<div
						className={cn(
							"grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] rounded-[1.25rem] border p-1 sm:inline-flex sm:w-auto",
							hasError
								? "border-red-200/80 bg-red-50/70"
								: "border-neutral-200 bg-neutral-100/90",
						)}
					>
						<button
							aria-pressed={!isInputActive}
							className={cn(
								"min-h-10 w-full min-w-0 rounded-[1rem] px-3 font-medium text-sm transition-colors sm:w-24 sm:px-4",
								getModeButtonClass({ active: !isInputActive, option: "off" }),
							)}
							onClick={() => {
								onChange("");
								setIsInputFocused(false);
								inputRef.current?.blur();
							}}
							type="button"
						>
							Off
						</button>
						<div
							className={cn(
								"flex min-h-10 min-w-0 items-center rounded-[1rem] transition-colors",
								ageThresholdStateClassName,
							)}
						>
							<Label className="sr-only" htmlFor="age-threshold">
								Age threshold
							</Label>
							<Input
								aria-describedby={hasError ? "age-threshold-error" : undefined}
								aria-invalid={hasError || undefined}
								className="h-10 w-full min-w-0 rounded-[1rem] border-0 bg-transparent px-0 text-center text-base shadow-none focus-visible:ring-0 sm:w-24"
								id="age-threshold"
								inputMode="numeric"
								min={minAgeThreshold}
								onBlur={() => {
									setIsInputFocused(false);
								}}
								onChange={(event) => {
									onChange(event.target.value);
								}}
								onFocus={() => {
									setIsInputFocused(true);
								}}
								placeholder={String(minAgeThreshold)}
								ref={inputRef}
								value={thresholdText}
							/>
						</div>
					</div>
				</div>
			</div>
			{errorMessage ? (
				<DemoNotice className="mt-4" title="Check the age rule">
					<span id="age-threshold-error">{errorMessage}</span>
				</DemoNotice>
			) : null}
		</div>
	);
}

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
				: "Waiting for the result",
			description: sessionStatus?.is_terminal
				? "This run has ended. Waiting for the final webhook delivery to arrive."
				: "Finish the verification on mobile and the result will appear here.",
		};
	}

	if (processedWebhook.status === "verified") {
		return {
			title: "Preparing the result",
			description:
				"Verifying the signature and decrypting the webhook payload locally in this browser.",
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

function RunStatusPanel({ run }: { run: DemoRunView | null }) {
	return (
		<div className="-mt-6 space-y-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				{run?.verification_url ? (
					<Button
						render={
							<a
								href={run.verification_url}
								rel="noopener noreferrer"
								target="_blank"
							>
								Start verification
							</a>
						}
					>
						Start verification
					</Button>
				) : (
					<Button disabled type="button">
						Start verification
					</Button>
				)}

				{run?.verification_url ? (
					<Button
						onClick={async () => {
							await navigator.clipboard.writeText(run.verification_url ?? "");
							toast.success("Verification URL copied");
						}}
						type="button"
						variant="outline"
					>
						<CopyIcon className="mr-2 size-4" />
						Copy URL
					</Button>
				) : null}
			</div>
		</div>
	);
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
		<div className="mb-6 flex flex-col gap-4 rounded-[1.25rem] border border-neutral-200/80 bg-neutral-50/80 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<p className="font-medium text-neutral-950 text-sm">Attempts</p>
				<p className="mt-1 text-neutral-600 text-sm leading-relaxed">
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

function WebhookPanel({
	processedWebhooks,
	run,
}: {
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
			return (
				<DemoDocumentPreviewPanel
					payload={processedWebhook.decryptedPayload ?? ""}
					preview={documentPreview}
					webhookMetadataItems={
						eventPreview ? buildWebhookMetadataItems(eventPreview) : []
					}
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

		if (processedWebhook.error) {
			return (
				<DemoNotice title="Local verification failed">
					{processedWebhook.error}
				</DemoNotice>
			);
		}

		if (!state) {
			return null;
		}

		return (
			<DocumentStatePanel description={state.description} title={state.title} />
		);
	})();

	return (
		<>
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

function DemoErrorAlert({
	onReset,
	runError,
}: {
	onReset: () => void;
	runError: string | null;
}) {
	if (!runError) {
		return null;
	}

	return (
		<DemoNotice
			action={
				<Button onClick={onReset} type="button" variant="outline">
					Try again
				</Button>
			}
			title="Demo error"
		>
			{runError}
		</DemoNotice>
	);
}

function DemoComposerStep({
	ageThresholdText,
	fieldModes,
	hasSession,
	isCreatingRun,
	isCreatingSession,
	isRestartingDemo,
	onAgeThresholdChange,
	onClaimModeChange,
	onCreateSession,
	onOpenStep,
	onRestartDemo,
	openStep,
	runId,
	selectionResult,
}: {
	ageThresholdText: string;
	fieldModes: Record<string, DemoFieldMode>;
	hasSession: boolean;
	isCreatingRun: boolean;
	isCreatingSession: boolean;
	isRestartingDemo: boolean;
	onAgeThresholdChange: (value: string) => void;
	onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
	onCreateSession: () => void;
	onOpenStep: (step: DemoStepId) => void;
	onRestartDemo: () => void;
	openStep: DemoStepId;
	runId: string | null;
	selectionResult: SelectionResult;
}) {
	return (
		<DemoStepPanel
			description="Pick the claims you would like to request."
			isOpen={openStep === "step-1"}
			onOpen={() => onOpenStep("step-1")}
			stepId="step-1"
			stepNumber={1}
			title="Choose the fields you want to test"
		>
			<div className="space-y-6">
				{demoClaimSections.map((section) => (
					<section className="space-y-4" key={section.title}>
						<div>
							<h2 className="font-medium text-lg text-neutral-950">
								{section.title}
							</h2>
							<p className="text-neutral-500 text-sm">{section.description}</p>
						</div>
						<div className="border-neutral-200/80 border-t">
							{section.claims.map((claimKey) => (
								<ModeSelector
									description={getClaimDescription(claimKey)}
									disabled={isLockedDemoClaim(claimKey)}
									key={claimKey}
									label={getClaimLabel(claimKey)}
									mode={fieldModes[claimKey] ?? "off"}
									onChange={(mode) => {
										onClaimModeChange(claimKey, mode);
									}}
								/>
							))}
						</div>
					</section>
				))}

				<section className="space-y-4">
					<div>
						<h2 className="font-medium text-lg text-neutral-950">Age Gate</h2>
						<p className="text-neutral-500 text-sm">
							Use this when you need to check if a user meets a minimum age
							requirement.
						</p>
					</div>
					<div className="border-neutral-200/80 border-t">
						<AgeGateSelector
							errorMessage={selectionResult.ok ? null : selectionResult.message}
							onChange={onAgeThresholdChange}
							thresholdText={ageThresholdText}
						/>
					</div>
				</section>

				<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
					{hasSession || isRestartingDemo ? (
						<Button
							disabled={isCreatingSession || isCreatingRun}
							onClick={onRestartDemo}
							type="button"
						>
							{isCreatingSession || isCreatingRun ? (
								<Loader2Icon className="mr-2 size-4 animate-spin" />
							) : null}
							Restart demo
						</Button>
					) : (
						<Button
							disabled={
								isCreatingSession ||
								isCreatingRun ||
								!runId ||
								!selectionResult.ok
							}
							onClick={onCreateSession}
							type="button"
						>
							{isCreatingSession ? (
								<Loader2Icon className="mr-2 size-4 animate-spin" />
							) : null}
							Create session
						</Button>
					)}
				</div>
			</div>
		</DemoStepPanel>
	);
}

function DemoVerificationStep({
	hasSession,
	onOpenStep,
	openStep,
	run,
}: {
	hasSession: boolean;
	onOpenStep: (step: DemoStepId) => void;
	openStep: DemoStepId;
	run: DemoRunView | null;
}) {
	return (
		<DemoStepPanel
			description="Open the session on mobile."
			isLocked={!hasSession}
			isOpen={openStep === "step-2"}
			onOpen={() => onOpenStep("step-2")}
			stepId="step-2"
			stepNumber={2}
			title="Complete the live verification"
		>
			<RunStatusPanel run={run} />
		</DemoStepPanel>
	);
}

function DemoOutcomeStep({
	canReviewOutcome,
	onOpenStep,
	openStep,
	processedWebhooks,
	run,
}: {
	canReviewOutcome: boolean;
	onOpenStep: (step: DemoStepId) => void;
	openStep: DemoStepId;
	processedWebhooks: ProcessedWebhookMap;
	run: DemoRunView | null;
}) {
	const sessionStatus = run?.session_status ?? null;
	const webhookHistory = useMemo(() => getDemoWebhookHistory(run), [run]);
	const isWaitingForTerminalWebhook = Boolean(
		sessionStatus?.is_terminal &&
			!isDemoRunSettled({
				processedWebhooks,
				sessionStatus,
				webhooks: webhookHistory,
			}),
	);

	return (
		<DemoStepPanel
			description="Review the result or restart the demo."
			isLocked={!canReviewOutcome}
			isOpen={openStep === "step-3"}
			onOpen={() => onOpenStep("step-3")}
			stepId="step-3"
			stepNumber={3}
			title="Review the outcome"
		>
			<div className="space-y-8">
				{isWaitingForTerminalWebhook ? (
					<Alert>
						<AlertTitle>Waiting for the webhook delivery</AlertTitle>
						<AlertDescription>
							This run has ended, but the final webhook event has not arrived
							yet. Keep this page open or restart the demo to try again.
						</AlertDescription>
					</Alert>
				) : null}

				<WebhookPanel processedWebhooks={processedWebhooks} run={run} />
			</div>
		</DemoStepPanel>
	);
}

export function Demo() {
	const [fieldModes, setFieldModes] =
		useState<Record<string, DemoFieldMode>>(initialFieldModes);
	const [ageThresholdText, setAgeThresholdText] = useState("");
	const [openStep, setOpenStep] = useState<DemoStepId>("step-1");
	const [privateKey, setPrivateKey] = useState<CryptoKey | null>(null);
	const [signingSecret, setSigningSecret] = useState<string | null>(null);
	const [runId, setRunId] = useState<string | null>(null);
	const [run, setRun] = useState<DemoRunView | null>(null);
	const [runError, setRunError] = useState<string | null>(null);
	const [isCreatingRun, setIsCreatingRun] = useState(false);
	const [isCreatingSession, setIsCreatingSession] = useState(false);
	const [isRestartingDemo, setIsRestartingDemo] = useState(false);
	const [processedWebhooks, setProcessedWebhooks] =
		useState<ProcessedWebhookMap>({});
	const [hasInitializedRun, setHasInitializedRun] = useState(false);

	const selectionResult = useMemo(
		() =>
			buildRequestedShareFields({
				ageThresholdText,
				fieldModes,
			}),
		[ageThresholdText, fieldModes],
	);
	const sessionStatus = run?.session_status ?? null;
	const webhookHistory = useMemo(() => getDemoWebhookHistory(run), [run]);
	const isRunSettled = isDemoRunSettled({
		processedWebhooks,
		sessionStatus,
		webhooks: webhookHistory,
	});
	const hasSession = Boolean(run?.session_id);
	const canReviewOutcome = Boolean(
		sessionStatus?.is_terminal || webhookHistory.length > 0,
	);

	const clearRunState = useCallback(() => {
		setOpenStep("step-1");
		setPrivateKey(null);
		setSigningSecret(null);
		setRunId(null);
		setRun(null);
		setRunError(null);
		setIsCreatingRun(false);
		setIsCreatingSession(false);
		setIsRestartingDemo(false);
		setProcessedWebhooks({});
		setHasInitializedRun(false);
	}, []);

	const handleReset = useCallback(() => {
		setFieldModes(initialFieldModes);
		setAgeThresholdText("");
		clearRunState();
	}, [clearRunState]);

	const provisionDemoRun = useCallback(async () => {
		const keyPair = await generateDemoKeyPair();
		const createdRun = await createDemoRun({
			publicJwk: keyPair.publicJwk,
		});
		const nextRun = createDemoRunView(createdRun);

		setPrivateKey(keyPair.privateKey);
		setSigningSecret(createdRun.signing_secret);
		setRunId(createdRun.demo_run_id);
		setRun(nextRun);

		return {
			nextRun,
			runId: createdRun.demo_run_id,
		};
	}, []);

	const handleGenerateRun = useCallback(async () => {
		setIsCreatingRun(true);
		setRunError(null);
		setProcessedWebhooks({});

		try {
			await provisionDemoRun();
			toast.success("Secure demo run created");
		} catch (error) {
			setRunError(
				error instanceof Error ? error.message : "Failed to create demo run.",
			);
		} finally {
			setIsCreatingRun(false);
		}
	}, [provisionDemoRun]);

	const handleOpenStep = useCallback((step: DemoStepId) => {
		setOpenStep(step);
	}, []);

	const handleClaimModeChange = useCallback(
		(claimKey: string, mode: DemoFieldMode) => {
			setFieldModes((current) => ({
				...current,
				[claimKey]: mode,
			}));
		},
		[],
	);

	const handleCreateSession = useCallback(async () => {
		if (!runId) {
			setRunError("Preparing the secure demo run. Try again in a moment.");
			return;
		}

		if (!selectionResult.ok) {
			setRunError(selectionResult.message);
			return;
		}

		setIsCreatingSession(true);
		setRunError(null);

		try {
			const session = await createDemoVerificationSession({
				runId,
				shareFields: selectionResult.shareFields,
			});

			setRun((current) =>
				current
					? {
							...current,
							session_id: session.session_id,
							share_fields: session.share_fields,
							verification_url: session.verification_url,
						}
					: null,
			);
			toast.success("Verification session created");
		} catch (error) {
			setRunError(
				error instanceof Error
					? error.message
					: "Failed to create demo session.",
			);
		} finally {
			setIsCreatingSession(false);
		}
	}, [runId, selectionResult]);

	const handleRestartDemo = useCallback(async () => {
		if (!selectionResult.ok) {
			setRunError(null);
			setOpenStep("step-1");
			return;
		}

		clearRunState();
		setHasInitializedRun(true);
		setIsRestartingDemo(true);
		setIsCreatingRun(true);
		setIsCreatingSession(true);
		setRunError(null);

		try {
			const { nextRun, runId: nextRunId } = await provisionDemoRun();
			const session = await createDemoVerificationSession({
				runId: nextRunId,
				shareFields: selectionResult.shareFields,
			});

			setRun({
				...nextRun,
				session_id: session.session_id,
				share_fields: session.share_fields,
				verification_url: session.verification_url,
			});
			toast.success("Demo restarted");
		} catch (error) {
			setRunError(
				error instanceof Error ? error.message : "Failed to restart demo.",
			);
		} finally {
			setIsRestartingDemo(false);
			setIsCreatingRun(false);
			setIsCreatingSession(false);
		}
	}, [clearRunState, provisionDemoRun, selectionResult]);

	const handleRunLoaded = useCallback((nextRun: DemoRunView) => {
		setRun(nextRun);
		setRunError(null);
	}, []);

	const handleRunError = useCallback((message: string) => {
		setRunError(message);
	}, []);

	useDemoRunInitialization({
		handleGenerateRun,
		hasInitializedRun,
		setHasInitializedRun,
	});

	useDemoStepProgression({
		canReviewOutcome,
		hasSession,
		onOpenStepChange: handleOpenStep,
	});

	useDemoStepScroll({
		openStep,
	});

	useDemoRunPolling({
		isRunSettled,
		onRunError: handleRunError,
		onRunLoaded: handleRunLoaded,
		runId,
	});

	useProcessedWebhookReceipts({
		onProcessedWebhooksChange: setProcessedWebhooks,
		privateKey,
		processedWebhooks,
		run,
		signingSecret,
	});

	return (
		<main className="relative min-h-screen overflow-hidden">
			<div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
				<PageHeading
					description="Test Kayle ID in your local browser — demo session metadata and webhook deliveries are stored temporarily, then automatically deleted."
					title="See how Kayle ID works with a demo."
				/>

				<div className="mt-12 space-y-8 sm:mt-16 lg:mt-20" id="demo-flow">
					<DemoErrorAlert onReset={handleReset} runError={runError} />

					<div className={accordionPanelClass}>
						<div className="divide-y divide-neutral-200/70">
							<DemoComposerStep
								ageThresholdText={ageThresholdText}
								fieldModes={fieldModes}
								hasSession={hasSession}
								isCreatingRun={isCreatingRun}
								isCreatingSession={isCreatingSession}
								isRestartingDemo={isRestartingDemo}
								onAgeThresholdChange={setAgeThresholdText}
								onClaimModeChange={handleClaimModeChange}
								onCreateSession={handleCreateSession}
								onOpenStep={handleOpenStep}
								onRestartDemo={handleRestartDemo}
								openStep={openStep}
								runId={runId}
								selectionResult={selectionResult}
							/>

							<DemoVerificationStep
								hasSession={hasSession}
								onOpenStep={handleOpenStep}
								openStep={openStep}
								run={run}
							/>

							<DemoOutcomeStep
								canReviewOutcome={canReviewOutcome}
								onOpenStep={handleOpenStep}
								openStep={openStep}
								processedWebhooks={processedWebhooks}
								run={run}
							/>
						</div>
					</div>
				</div>
			</div>
		</main>
	);
}
