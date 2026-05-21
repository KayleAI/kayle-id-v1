import { TooltipProvider } from "@kayle-id/ui/components/tooltip";
import {
	type ComponentType,
	useCallback,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	buildRequestedShareFields,
	initialFieldModes,
} from "@/demo/claim-fields";
import { generateDemoKeyPair } from "@/demo/crypto";
import type {
	DemoFieldMode,
	DemoRunCreateResult,
	DemoRunView,
} from "@/demo/types";
import { getDemoWebhookHistory } from "@/demo/webhook-history";
import { DemoFlow } from "@/marketing/demo/demo-flow";
import { DemoErrorAlert } from "@/marketing/demo/demo-notice";
import { DemoOutcomeStep } from "@/marketing/demo/outcome-step";
import type { DemoComposerProps, DemoCopy } from "@/marketing/demo/types";
import { DemoVerificationStep } from "@/marketing/demo/verification-step";
import {
	createDemoRun,
	createDemoVerificationSession,
} from "@/marketing/demo-api";
import {
	isDemoRunSettled,
	type ProcessedWebhookMap,
} from "@/marketing/demo-attempts";
import {
	type DemoStepId,
	useDemoRunInitialization,
	useDemoRunPolling,
	useDemoStepProgression,
	useDemoStepScroll,
	useProcessedWebhookReceipts,
} from "@/marketing/demo-hooks";
import { getErrorMessage } from "@/utils/get-error-message";

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

export function DemoShell({
	Composer,
	copy,
	initialAgeThresholdText,
	outcomeMode = "document",
}: {
	Composer: ComponentType<DemoComposerProps>;
	copy: DemoCopy;
	initialAgeThresholdText: string;
	outcomeMode?: "age" | "document";
}) {
	const [fieldModes, setFieldModes] =
		useState<Record<string, DemoFieldMode>>(initialFieldModes);
	const [ageThresholdText, setAgeThresholdText] = useState(
		initialAgeThresholdText,
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
	const activeRunIdRef = useRef<string | null>(null);

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
		activeRunIdRef.current = null;
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
		setAgeThresholdText(initialAgeThresholdText);
		clearRunState();
	}, [clearRunState, initialAgeThresholdText]);

	const handleChangeDetails = useCallback(() => {
		clearRunState();
	}, [clearRunState]);

	const provisionDemoRun = useCallback(async () => {
		const keyPair = await generateDemoKeyPair();
		const createdRun = await createDemoRun({
			publicJwk: keyPair.publicJwk,
		});
		const nextRun = createDemoRunView(createdRun);

		activeRunIdRef.current = createdRun.demo_run_id;
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
			setRunError(getErrorMessage(error, "Failed to create demo run."));
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
			setRunError(getErrorMessage(error, "Failed to create demo session."));
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
			setRunError(getErrorMessage(error, "Failed to restart demo."));
		} finally {
			setIsRestartingDemo(false);
			setIsCreatingRun(false);
			setIsCreatingSession(false);
		}
	}, [clearRunState, provisionDemoRun, selectionResult]);

	const handleRunLoaded = useCallback((nextRun: DemoRunView) => {
		if (nextRun.id !== activeRunIdRef.current) {
			return;
		}

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

	const activeStepContent = (() => {
		if (openStep === "step-2") {
			return <DemoVerificationStep hasSession={hasSession} run={run} />;
		}

		if (openStep === "step-3") {
			return (
				<DemoOutcomeStep
					canReviewOutcome={canReviewOutcome}
					mode={outcomeMode}
					processedWebhooks={processedWebhooks}
					run={run}
				/>
			);
		}

		return (
			<Composer
				ageThresholdText={ageThresholdText}
				fieldModes={fieldModes}
				hasSession={hasSession}
				isCreatingRun={isCreatingRun}
				isCreatingSession={isCreatingSession}
				isRestartingDemo={isRestartingDemo}
				onAgeThresholdChange={handleAgeThresholdChange}
				onClaimModeChange={handleClaimModeChange}
				onCreateSession={handleCreateSession}
				onRestartDemo={handleRestartDemo}
				runId={runId}
				selectionResult={selectionResult}
			/>
		);
	})();

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

				<DemoFlow onChangeDetails={handleChangeDetails} stepId={openStep}>
					{runError ? (
						<div className="mb-6">
							<DemoErrorAlert onReset={handleReset} runError={runError} />
						</div>
					) : null}
					{activeStepContent}
				</DemoFlow>
			</main>
		</TooltipProvider>
	);
}
