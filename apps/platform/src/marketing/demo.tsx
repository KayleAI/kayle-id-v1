import { getClaimLabel, minAgeThreshold } from "@kayle-id/config/share-claims";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import {
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandList,
} from "@kayleai/ui/command";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kayleai/ui/tooltip";
import { cn } from "@kayleai/ui/utils/cn";
import { Command as CommandPrimitive } from "cmdk";
import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CopyIcon,
	Loader2Icon,
	SearchIcon,
	XIcon,
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
	DemoWebhookEnvelope,
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

interface DemoNoticeProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	title?: string;
}

type SelectionResult = ReturnType<typeof buildRequestedShareFields>;

export type DemoMode = "id" | "age";

const DEMO_MODE_COPY: Record<
	DemoMode,
	{
		title: string;
		description: string;
		composerTitle: string;
		composerDescription: string;
	}
> = {
	id: {
		title: "See how Kayle ID works with a demo.",
		description:
			"Test Kayle ID in your local browser — demo session metadata and webhook deliveries are stored temporarily, then automatically deleted.",
		composerTitle: "Choose the fields you want to test",
		composerDescription: "Pick the claims you would like to request.",
	},
	age: {
		title: "See how age verification works with a demo.",
		description:
			"Confirm a user is over a given age without revealing their date of birth — runs in your local browser, then automatically deletes itself.",
		composerTitle: "Set the minimum age",
		composerDescription:
			"Pick the threshold to verify. Kayle returns an over-N proof rather than the full date of birth.",
	},
};

function getModeButtonClass({
	active,
	option,
}: {
	active: boolean;
	option: DemoFieldMode;
}): string {
	if (!active) {
		return "text-muted-foreground hover:text-foreground";
	}

	if (option === "optional" || option === "required") {
		return "bg-foreground text-background";
	}

	return "bg-background text-foreground";
}

function DemoNotice({ action, children, className, title }: DemoNoticeProps) {
	return (
		<div
			className={cn(
				"rounded-[1rem] border border-red-200/70 bg-red-50/40 px-4 py-3 dark:border-red-900/70 dark:bg-red-950/30",
				className,
			)}
			role="alert"
		>
			<div className="flex items-start gap-3">
				<div className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500/90" />
				<div className="min-w-0 flex-1">
					{title ? (
						<p className="font-medium text-red-950 text-sm dark:text-red-200">
							{title}
						</p>
					) : null}
					<div
						className={cn(
							"text-sm leading-relaxed",
							title
								? "mt-1 text-red-800/90 dark:text-red-200/90"
								: "text-red-900/90 dark:text-red-200/90",
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
	stepId,
	title,
	className,
}: {
	children?: ReactNode;
	description: string;
	isLocked?: boolean;
	stepId: DemoStepId;
	title: string;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"scroll-mt-24 rounded-2xl border border-border/70 bg-card/70 p-6 sm:p-8",
				isLocked && "pointer-events-none opacity-50",
				className,
			)}
			id={getDemoStepSectionId(stepId)}
		>
			<h2 className="font-light text-2xl text-foreground tracking-tight">
				{title}
			</h2>
			<p className="mb-4 mt-1.5 max-w-2xl text-muted-foreground text-pretty leading-relaxed">
				{description}
			</p>
			{children}
		</section>
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
	let ageThresholdStateClassName =
		"text-muted-foreground hover:text-foreground";

	if (isInputActive) {
		ageThresholdStateClassName = hasError
			? "bg-background ring-1 ring-red-200 dark:ring-red-900/70"
			: "bg-background";
	}

	return (
		<div className="border-border/70 border-b py-4 sm:py-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 pr-0 sm:pr-6">
					<div className="font-medium text-base text-foreground">
						Minimum age
					</div>
					<p className="max-w-xl text-muted-foreground text-sm leading-relaxed">
						Entering `18` asks for an over-18 proof rather than the full date of
						birth.
					</p>
				</div>
				<div className="w-full sm:w-auto sm:shrink-0">
					<div
						className={cn(
							"grid min-h-12 w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)] rounded-[1.25rem] border p-1 sm:inline-flex sm:w-auto",
							hasError
								? "border-red-200/80 bg-red-50/70 dark:border-red-900/70 dark:bg-red-950/30"
								: "border-border bg-muted/80",
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
		<div className="space-y-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
				{run?.verification_url ? (
					<Button
						nativeButton={false}
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
		<div className="mb-6 flex flex-col gap-4 rounded-[1.25rem] border border-border/70 bg-muted/40 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
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

const DEFAULT_AGE_THRESHOLD = "18";

function ClaimPicker({
	ageErrorMessage,
	ageThresholdText,
	fieldModes,
	onAgeThresholdChange,
	onClaimModeChange,
}: {
	ageErrorMessage?: string | null;
	ageThresholdText: string;
	fieldModes: Record<string, DemoFieldMode>;
	onAgeThresholdChange: (value: string) => void;
	onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
}) {
	const isAgeSelected = ageThresholdText.trim() !== "";
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) {
			return;
		}
		function handlePointerDown(event: PointerEvent) {
			const node = containerRef.current;
			if (node && !node.contains(event.target as Node)) {
				setOpen(false);
			}
		}
		document.addEventListener("pointerdown", handlePointerDown);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [open]);

	const selectedClaims = useMemo(
		() =>
			demoClaimSections.flatMap((section) =>
				section.claims
					.filter((claimKey) => !isLockedDemoClaim(claimKey))
					.filter((claimKey) => {
						const mode = fieldModes[claimKey] ?? "off";
						return mode === "optional" || mode === "required";
					})
					.map((claimKey) => ({ claimKey, sectionTitle: section.title })),
			),
		[fieldModes],
	);

	const sectionsForPicker = useMemo(
		() =>
			demoClaimSections
				.map((section) => ({
					title: section.title,
					claims: section.claims.filter(
						(claimKey) => !isLockedDemoClaim(claimKey),
					),
				}))
				.filter((section) => section.claims.length > 0),
		[],
	);

	return (
		<div className="space-y-4">
			<div className="relative" ref={containerRef}>
				<CommandPrimitive
					className="overflow-visible"
					label="Add claim"
					onKeyDown={(event) => {
						if (event.key === "Escape") {
							event.preventDefault();
							setOpen(false);
						}
					}}
					shouldFilter
				>
					<div className="flex h-11 items-center gap-2 rounded-[1rem] border border-border bg-background px-3 has-[input:focus]:border-ring">
						<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
						<CommandPrimitive.Input
							className="flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
							onClick={() => setOpen(true)}
							onFocus={() => setOpen(true)}
							onValueChange={setQuery}
							placeholder="Search claims to add…"
							value={query}
						/>
					</div>
					{open ? (
						<div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-xl border border-border bg-popover shadow-lg ring-1 ring-border/60">
							<CommandList className="max-h-72 **:data-[slot=command-group-items]:space-y-0.5 **:[[data-slot=command-item][data-selected=false]]:bg-transparent **:[[data-slot=command-item][data-selected=true]]:bg-muted">
								<CommandEmpty>No matching claims.</CommandEmpty>
								<CommandGroup heading="Constraints">
									<CommandItem
										data-checked={isAgeSelected ? "true" : undefined}
										keywords={[
											"minimum age",
											"age gate",
											"age threshold",
											"over 18",
											"age verification",
										]}
										onSelect={() => {
											if (isAgeSelected) {
												onAgeThresholdChange("");
											} else {
												onAgeThresholdChange(DEFAULT_AGE_THRESHOLD);
											}
											setQuery("");
										}}
										value="minimum_age"
									>
										<span className="font-medium text-foreground">
											Minimum age
										</span>
										<span className="ml-2 flex-1 truncate text-muted-foreground text-xs">
											Request an over-N proof rather than the date of birth.
										</span>
									</CommandItem>
								</CommandGroup>
								{sectionsForPicker.map((section) => (
									<CommandGroup heading={section.title} key={section.title}>
										{section.claims.map((claimKey) => {
											const mode = fieldModes[claimKey] ?? "off";
											const isSelected =
												mode === "optional" || mode === "required";
											return (
												<CommandItem
													data-checked={isSelected ? "true" : undefined}
													key={claimKey}
													keywords={[
														getClaimLabel(claimKey),
														getClaimDescription(claimKey) ?? "",
													]}
													onSelect={() => {
														onClaimModeChange(
															claimKey,
															isSelected ? "off" : "optional",
														);
														setQuery("");
													}}
													value={claimKey}
												>
													<span className="font-medium text-foreground">
														{getClaimLabel(claimKey)}
													</span>
													{getClaimDescription(claimKey) ? (
														<span className="ml-2 flex-1 truncate text-muted-foreground text-xs">
															{getClaimDescription(claimKey)}
														</span>
													) : null}
												</CommandItem>
											);
										})}
									</CommandGroup>
								))}
							</CommandList>
						</div>
					) : null}
				</CommandPrimitive>
			</div>

			{selectedClaims.length === 0 && !isAgeSelected ? (
				<p className="rounded-[1rem] border border-border/70 border-dashed bg-background/50 px-4 py-4.5 text-center text-muted-foreground text-sm">
					Nothing selected — search above to add a claim or constraint.
				</p>
			) : (
				<ul className="divide-y divide-border/70 overflow-hidden rounded-[1rem] border border-border/70 bg-background">
					{isAgeSelected ? (
						<li className="flex items-center gap-3 px-3 py-2.5">
							<div className="min-w-0 flex-1">
								<div className="font-medium text-foreground text-sm">
									Minimum age
								</div>
								<div className="hidden truncate text-muted-foreground text-xs sm:block">
									Returns an over-N proof rather than the date of birth.
								</div>
								{ageErrorMessage ? (
									<div className="mt-1 text-red-700 text-xs dark:text-red-300">
										{ageErrorMessage}
									</div>
								) : null}
							</div>
							<Label className="sr-only" htmlFor="claim-age-threshold">
								Age threshold
							</Label>
							<Input
								aria-invalid={ageErrorMessage ? true : undefined}
								className={cn(
									"h-9 w-20 rounded-[0.75rem] text-center text-sm shadow-none",
									ageErrorMessage
										? "border-red-200 ring-1 ring-red-200 dark:border-red-900/70 dark:ring-red-900/70"
										: "border-border",
								)}
								id="claim-age-threshold"
								inputMode="numeric"
								min={minAgeThreshold}
								onChange={(event) => {
									onAgeThresholdChange(event.target.value);
								}}
								placeholder={DEFAULT_AGE_THRESHOLD}
								value={ageThresholdText}
							/>
							<button
								aria-label="Remove minimum age"
								className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={() => onAgeThresholdChange("")}
								type="button"
							>
								<XIcon className="size-4" />
							</button>
						</li>
					) : null}
					{selectedClaims.map(({ claimKey }) => {
						const mode: DemoFieldMode =
							fieldModes[claimKey] === "required" ? "required" : "optional";
						return (
							<li
								className="flex items-center gap-3 px-3 py-2.5"
								key={claimKey}
							>
								<div className="min-w-0 flex-1">
									<div className="font-medium text-foreground text-sm">
										{getClaimLabel(claimKey)}
									</div>
									{getClaimDescription(claimKey) ? (
										<div className="hidden truncate text-muted-foreground text-xs sm:block">
											{getClaimDescription(claimKey)}
										</div>
									) : null}
								</div>
								{/* Mobile: native select. Tooltip-style hint for the disabled
								"Optional" option doesn't translate to a native control; the
								option is just shown disabled. */}
								<select
									aria-label={`${getClaimLabel(claimKey)} mode`}
									className="shrink-0 rounded-full border border-border bg-muted/80 px-3 py-1 font-medium text-foreground text-xs sm:hidden"
									onChange={(event) => {
										onClaimModeChange(
											claimKey,
											event.target.value as DemoFieldMode,
										);
									}}
									value={mode}
								>
									<option
										disabled={claimKey === "date_of_birth" && isAgeSelected}
										value="optional"
									>
										{getModeLabel("optional")}
									</option>
									<option value="required">{getModeLabel("required")}</option>
								</select>
								<div className="hidden shrink-0 rounded-full border border-border bg-muted/80 p-0.5 sm:inline-flex">
									{(["optional", "required"] as const).map((option) => {
										const active = mode === option;
										const isDisabled =
											claimKey === "date_of_birth" &&
											isAgeSelected &&
											option === "optional";
										const button = (
											<button
												aria-pressed={active}
												className={cn(
													"rounded-full px-3 py-1 font-medium text-xs transition-colors",
													active
														? "bg-foreground text-background"
														: "text-muted-foreground hover:text-foreground",
													isDisabled &&
														"cursor-not-allowed text-muted-foreground/40 hover:text-muted-foreground/40",
												)}
												disabled={isDisabled}
												onClick={() => onClaimModeChange(claimKey, option)}
												type="button"
											>
												{getModeLabel(option)}
											</button>
										);
										if (isDisabled) {
											return (
												<Tooltip key={option}>
													<TooltipTrigger aria-label="Why is this disabled?">
														<span className="inline-flex">{button}</span>
													</TooltipTrigger>
													<TooltipContent className="max-w-xs text-center">
														Date of Birth automatically becomes required while a
														minimum-age constraint is active
													</TooltipContent>
												</Tooltip>
											);
										}
										return <span key={option}>{button}</span>;
									})}
								</div>
								<button
									aria-label={`Remove ${getClaimLabel(claimKey)}`}
									className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
									onClick={() => onClaimModeChange(claimKey, "off")}
									type="button"
								>
									<XIcon className="size-4" />
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}

function DemoComposerStep({
	ageThresholdText,
	fieldModes,
	hasSession,
	isCreatingRun,
	isCreatingSession,
	isRestartingDemo,
	mode,
	onAgeThresholdChange,
	onClaimModeChange,
	onCreateSession,
	onRestartDemo,
	runId,
	selectionResult,
}: {
	ageThresholdText: string;
	fieldModes: Record<string, DemoFieldMode>;
	hasSession: boolean;
	isCreatingRun: boolean;
	isCreatingSession: boolean;
	isRestartingDemo: boolean;
	mode: DemoMode;
	onAgeThresholdChange: (value: string) => void;
	onClaimModeChange: (claimKey: string, mode: DemoFieldMode) => void;
	onCreateSession: () => void;
	onRestartDemo: () => void;
	runId: string | null;
	selectionResult: SelectionResult;
}) {
	const copy = DEMO_MODE_COPY[mode];

	return (
		<DemoStepPanel
			description={copy.composerDescription}
			stepId="step-1"
			title={copy.composerTitle}
		>
			<div className="space-y-6">
				{mode === "id" ? (
					<ClaimPicker
						ageErrorMessage={
							selectionResult.ok ? null : selectionResult.message
						}
						ageThresholdText={ageThresholdText}
						fieldModes={fieldModes}
						onAgeThresholdChange={onAgeThresholdChange}
						onClaimModeChange={onClaimModeChange}
					/>
				) : (
					<AgeGateSelector
						errorMessage={selectionResult.ok ? null : selectionResult.message}
						onChange={onAgeThresholdChange}
						thresholdText={ageThresholdText}
					/>
				)}

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
	run,
}: {
	hasSession: boolean;
	run: DemoRunView | null;
}) {
	return (
		<DemoStepPanel
			description="Open the session on mobile."
			isLocked={!hasSession}
			stepId="step-2"
			title="Complete the live verification"
		>
			<RunStatusPanel run={run} />
		</DemoStepPanel>
	);
}

function DemoOutcomeStep({
	canReviewOutcome,
	processedWebhooks,
	run,
}: {
	canReviewOutcome: boolean;
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
			stepId="step-3"
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

export function Demo({ mode = "id" }: { mode?: DemoMode } = {}) {
	const copy = DEMO_MODE_COPY[mode];
	const [fieldModes, setFieldModes] =
		useState<Record<string, DemoFieldMode>>(initialFieldModes);
	const [ageThresholdText, setAgeThresholdText] = useState(
		mode === "age" ? DEFAULT_AGE_THRESHOLD : "",
	);
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
		setAgeThresholdText(mode === "age" ? DEFAULT_AGE_THRESHOLD : "");
		clearRunState();
	}, [clearRunState, mode]);

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

	const isAgeGateActive = ageThresholdText.trim() !== "";

	const handleClaimModeChange = useCallback(
		(claimKey: string, mode: DemoFieldMode) => {
			const effectiveMode: DemoFieldMode =
				claimKey === "date_of_birth" && isAgeGateActive && mode === "optional"
					? "required"
					: mode;
			setFieldModes((current) => ({
				...current,
				[claimKey]: effectiveMode,
			}));
		},
		[isAgeGateActive],
	);

	const handleAgeThresholdChange = useCallback((value: string) => {
		setAgeThresholdText(value);
		if (value.trim() !== "") {
			setFieldModes((current) =>
				current.date_of_birth === "optional"
					? { ...current, date_of_birth: "required" }
					: current,
			);
		}
	}, []);

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
		<TooltipProvider>
			<main className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
				<section className="mb-16 sm:mb-20">
					<h1 className="mx-auto max-w-[22ch] text-balance text-center font-light text-5xl text-foreground tracking-tighter sm:text-6xl">
						{copy.title}
					</h1>
					<p className="mx-auto mt-6 max-w-[56ch] text-balance text-center text-lg text-muted-foreground sm:mt-8 sm:text-xl">
						{copy.description}
					</p>
				</section>

				<div className="space-y-6" id="demo-flow">
					<DemoErrorAlert onReset={handleReset} runError={runError} />

					<div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
						<div className="min-w-0 lg:col-span-7">
							<DemoComposerStep
								ageThresholdText={ageThresholdText}
								fieldModes={fieldModes}
								hasSession={hasSession}
								isCreatingRun={isCreatingRun}
								isCreatingSession={isCreatingSession}
								isRestartingDemo={isRestartingDemo}
								mode={mode}
								onAgeThresholdChange={handleAgeThresholdChange}
								onClaimModeChange={handleClaimModeChange}
								onCreateSession={handleCreateSession}
								onRestartDemo={handleRestartDemo}
								runId={runId}
								selectionResult={selectionResult}
							/>
						</div>

						<div className="min-w-0 space-y-6 lg:col-span-5">
							<DemoVerificationStep hasSession={hasSession} run={run} />
							<DemoOutcomeStep
								canReviewOutcome={canReviewOutcome}
								processedWebhooks={processedWebhooks}
								run={run}
							/>
						</div>
					</div>
				</div>
			</main>
		</TooltipProvider>
	);
}
