import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Badge } from "@kayleai/ui/badge";
import { Button } from "@kayleai/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kayleai/ui/dialog";
import { Input } from "@kayleai/ui/input";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@kayleai/ui/input-otp";
import { Label } from "@kayleai/ui/label";
import { CheckCircle2Icon, DownloadIcon, ShieldCheckIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useReducer, useState } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "@/utils/use-copy";

const TOTP_CODE_LENGTH = 6;
const BACKUP_CODES_FILENAME = "kayle-id-backup-codes.txt";

interface EnrolmentPayload {
	totpURI: string;
	secret: string;
	backupCodes: string[];
}

type EnableState =
	| { status: "idle"; errorMessage: string }
	| { status: "loading"; errorMessage: string }
	| {
			status: "scan";
			errorMessage: string;
			payload: EnrolmentPayload;
			showManualEntry: boolean;
	  }
	| {
			status: "verify";
			errorMessage: string;
			payload: EnrolmentPayload;
			code: string;
			isVerifying: boolean;
	  }
	| {
			status: "saved";
			errorMessage: string;
			payload: EnrolmentPayload;
	  };

type EnableAction =
	| { type: "BEGIN" }
	| { type: "RECEIVE_PAYLOAD"; payload: EnrolmentPayload }
	| { type: "TOGGLE_MANUAL_ENTRY" }
	| { type: "GO_TO_VERIFY" }
	| { type: "GO_TO_SCAN" }
	| { type: "SET_CODE"; code: string }
	| { type: "VERIFY_BEGIN" }
	| { type: "VERIFY_FAILED"; message: string }
	| { type: "VERIFIED" }
	| { type: "ERROR"; message: string }
	| { type: "RESET" };

const initialEnableState: EnableState = {
	status: "idle",
	errorMessage: "",
};

function reduceEnableState(
	state: EnableState,
	action: EnableAction,
): EnableState {
	switch (action.type) {
		case "BEGIN":
			return { status: "loading", errorMessage: "" };
		case "RECEIVE_PAYLOAD":
			return {
				status: "scan",
				errorMessage: "",
				payload: action.payload,
				showManualEntry: false,
			};
		case "TOGGLE_MANUAL_ENTRY":
			if (state.status !== "scan") {
				return state;
			}
			return { ...state, showManualEntry: !state.showManualEntry };
		case "GO_TO_VERIFY":
			if (state.status !== "scan") {
				return state;
			}
			return {
				status: "verify",
				errorMessage: "",
				payload: state.payload,
				code: "",
				isVerifying: false,
			};
		case "GO_TO_SCAN":
			if (state.status !== "verify") {
				return state;
			}
			return {
				status: "scan",
				errorMessage: "",
				payload: state.payload,
				showManualEntry: false,
			};
		case "SET_CODE":
			if (state.status !== "verify") {
				return state;
			}
			return { ...state, code: action.code, errorMessage: "" };
		case "VERIFY_BEGIN":
			if (state.status !== "verify") {
				return state;
			}
			return { ...state, isVerifying: true, errorMessage: "" };
		case "VERIFY_FAILED":
			if (state.status !== "verify") {
				return state;
			}
			return { ...state, errorMessage: action.message, isVerifying: false };
		case "VERIFIED":
			if (state.status !== "verify") {
				return state;
			}
			return {
				status: "saved",
				errorMessage: "",
				payload: state.payload,
			};
		case "ERROR":
			return { status: "idle", errorMessage: action.message };
		case "RESET":
			return initialEnableState;
		default:
			return state;
	}
}

// better-auth builds the otpauth URI with `URLSearchParams`, which encodes
// spaces as `+` (form-encoding). The otpauth scheme is *not* form-encoded —
// authenticator apps (1Password, Authy, Google Authenticator, etc.) display
// the label and issuer literally, so a `+` shows up as a plus sign instead of
// a space ("Kayle+ID:..." rather than "Kayle ID:..."). Re-encode `+` as `%20`
// so the spaces survive. Base32 secrets only use [A-Z2-7] so this is safe.
function normalizeTotpUri(uri: string): string {
	return uri.replaceAll("+", "%20");
}

function parseSecretFromTotpUri(uri: string): string {
	try {
		const parsed = new URL(uri);
		return parsed.searchParams.get("secret") ?? "";
	} catch {
		return "";
	}
}

function downloadBackupCodes(codes: string[]): void {
	const header = [
		"Kayle ID — two-factor authentication backup codes",
		"",
		"Each code can be used once. Keep them somewhere safe.",
		"",
	].join("\n");
	const blob = new Blob([`${header}${codes.join("\n")}\n`], {
		type: "text/plain",
	});
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = BACKUP_CODES_FILENAME;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

function ScanStep({
	state,
	dispatch,
}: {
	state: Extract<EnableState, { status: "scan" }>;
	dispatch: React.Dispatch<EnableAction>;
}) {
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="space-y-5">
			<p className="text-muted-foreground text-sm">
				Open your authenticator app (1Password, Authy, Google Authenticator,
				etc.) and scan the QR code below.
			</p>
			<div className="flex justify-center">
				{/* `bg-white` here is intentional — QR code scanners need a
				 * high-contrast static white background regardless of the
				 * active theme; the SVG modules are black-on-white. */}
				<div className="rounded-lg border bg-white p-4">
					<QRCodeSVG
						aria-label="Two-factor authentication QR code"
						level="M"
						size={192}
						value={state.payload.totpURI}
					/>
				</div>
			</div>
			<div className="flex justify-center">
				<Button
					onClick={() => dispatch({ type: "TOGGLE_MANUAL_ENTRY" })}
					size="sm"
					type="button"
					variant="ghost"
				>
					{state.showManualEntry
						? "Hide manual entry"
						: "Can't scan? Enter manually"}
				</Button>
			</div>
			{state.showManualEntry ? (
				<div className="space-y-2">
					<Label className="font-medium text-sm" htmlFor="totp-secret">
						Secret key
					</Label>
					<div className="relative">
						<Input
							className="pr-20 font-mono text-sm"
							id="totp-secret"
							readOnly
							value={state.payload.secret}
						/>
						<Button
							className="-translate-y-1/2 absolute top-1/2 right-2"
							onClick={() => copy(state.payload.secret)}
							size="sm"
							type="button"
							variant="outline"
						>
							{copied ? "Copied!" : "Copy"}
						</Button>
					</div>
					<p className="text-muted-foreground text-xs">
						Time-based, 6 digits, SHA-1.
					</p>
				</div>
			) : null}
		</div>
	);
}

function VerifyStep({
	state,
	dispatch,
	onVerify,
}: {
	state: Extract<EnableState, { status: "verify" }>;
	dispatch: React.Dispatch<EnableAction>;
	onVerify: () => void;
}) {
	return (
		<div className="space-y-5">
			<p className="text-muted-foreground text-sm">
				Enter the 6-digit code from your authenticator app to confirm enrolment.
			</p>
			<fieldset className="space-y-2">
				<legend className="mb-2 text-muted-foreground text-sm">
					Verification code
				</legend>
				<InputOTP
					autoFocus
					containerClassName="w-full"
					disabled={state.isVerifying}
					maxLength={TOTP_CODE_LENGTH}
					onChange={(value) => dispatch({ type: "SET_CODE", code: value })}
					onComplete={onVerify}
					value={state.code}
				>
					<InputOTPGroup className="flex-1 gap-0">
						<InputOTPSlot
							className="h-12! flex-1 rounded-l-4xl text-lg"
							index={0}
						/>
						<InputOTPSlot className="h-12! flex-1 text-lg" index={1} />
						<InputOTPSlot
							className="h-12! flex-1 rounded-r-4xl text-lg"
							index={2}
						/>
					</InputOTPGroup>
					<InputOTPSeparator className="mx-2" />
					<InputOTPGroup className="flex-1 gap-0">
						<InputOTPSlot
							className="h-12! flex-1 rounded-l-4xl text-lg"
							index={3}
						/>
						<InputOTPSlot className="h-12! flex-1 text-lg" index={4} />
						<InputOTPSlot
							className="h-12! flex-1 rounded-r-4xl text-lg"
							index={5}
						/>
					</InputOTPGroup>
				</InputOTP>
			</fieldset>
			{state.errorMessage ? (
				<Alert variant="destructive">
					<AlertTitle>Verification failed</AlertTitle>
					<AlertDescription>{state.errorMessage}</AlertDescription>
				</Alert>
			) : null}
		</div>
	);
}

function BackupCodesStep({ codes }: { codes: string[] }) {
	const { copied, copy } = useCopyToClipboard();
	const formatted = codes.join("\n");

	return (
		<div className="space-y-4">
			<Alert>
				<AlertTitle>Save these backup codes</AlertTitle>
				<AlertDescription>
					Each code works once and lets you sign in if you lose your
					authenticator app. You won't see them again.
				</AlertDescription>
			</Alert>
			<div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
				{codes.map((code) => (
					<span className="select-all" key={code}>
						{code}
					</span>
				))}
			</div>
			<div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
				<Button
					onClick={() => downloadBackupCodes(codes)}
					type="button"
					variant="outline"
				>
					<DownloadIcon className="size-4" />
					Download .txt
				</Button>
				<Button onClick={() => copy(formatted)} type="button" variant="outline">
					{copied ? "Copied!" : "Copy all"}
				</Button>
			</div>
		</div>
	);
}

function DisableTwoFactorDialog({
	open,
	onOpenChange,
	onConfirm,
	isLoading,
	errorMessage,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	isLoading: boolean;
	errorMessage: string;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="flex w-full max-w-md! flex-col">
				<DialogHeader>
					<DialogTitle>Disable two-factor authentication?</DialogTitle>
					<DialogDescription>
						You'll be able to sign in with just your email or Google account
						again. You can re-enable two-factor authentication anytime.
					</DialogDescription>
				</DialogHeader>
				{errorMessage ? (
					<Alert variant="destructive">
						<AlertTitle>Failed to disable</AlertTitle>
						<AlertDescription>{errorMessage}</AlertDescription>
					</Alert>
				) : null}
				<DialogFooter>
					<Button
						disabled={isLoading}
						onClick={() => onOpenChange(false)}
						variant="secondary"
					>
						Cancel
					</Button>
					<Button
						disabled={isLoading}
						onClick={onConfirm}
						variant="destructive"
					>
						{isLoading ? "Disabling..." : "Disable"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

const ENROLMENT_STEPS = [
	{ key: "scan", label: "Scan" },
	{ key: "verify", label: "Verify" },
	{ key: "saved", label: "Backup codes" },
] as const;

function EnrolmentStepIndicator({
	current,
}: {
	current: "scan" | "verify" | "saved";
}) {
	const currentIndex = ENROLMENT_STEPS.findIndex((s) => s.key === current);
	return (
		<ol className="flex items-center justify-center gap-2 text-xs">
			{ENROLMENT_STEPS.map((step, index) => {
				const isActive = index === currentIndex;
				const isComplete = index < currentIndex;
				return (
					<li className="flex items-center gap-2" key={step.key}>
						<span
							className={
								isActive
									? "flex size-6 items-center justify-center rounded-full bg-primary font-medium text-primary-foreground"
									: isComplete
										? "flex size-6 items-center justify-center rounded-full bg-primary/20 font-medium text-primary"
										: "flex size-6 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground"
							}
						>
							{isComplete ? (
								<CheckCircle2Icon className="size-3.5" />
							) : (
								index + 1
							)}
						</span>
						<span
							className={
								isActive
									? "font-medium"
									: isComplete
										? "text-primary"
										: "text-muted-foreground"
							}
						>
							{step.label}
						</span>
						{index < ENROLMENT_STEPS.length - 1 ? (
							<span aria-hidden="true" className="text-muted-foreground">
								›
							</span>
						) : null}
					</li>
				);
			})}
		</ol>
	);
}

export function TwoFactorAuthSection() {
	const { user, refresh } = useAuth();
	const twoFactorEnabled = Boolean(
		(user as { twoFactorEnabled?: boolean } | null)?.twoFactorEnabled,
	);
	const [enableState, dispatch] = useReducer(
		reduceEnableState,
		initialEnableState,
	);
	const [disableOpen, setDisableOpen] = useState(false);
	const [disableState, setDisableState] = useState<{
		isLoading: boolean;
		errorMessage: string;
	}>({ isLoading: false, errorMessage: "" });

	const handleBeginEnrolment = async () => {
		dispatch({ type: "BEGIN" });

		const { data, error } = await client.twoFactor.enable({});

		if (error || !data) {
			dispatch({
				type: "ERROR",
				message:
					error?.message ??
					"We couldn't start two-factor enrolment. Please try again.",
			});
			return;
		}

		const totpURI = normalizeTotpUri(data.totpURI);
		dispatch({
			type: "RECEIVE_PAYLOAD",
			payload: {
				totpURI,
				secret: parseSecretFromTotpUri(totpURI),
				backupCodes: data.backupCodes,
			},
		});
	};

	const handleVerifyEnrolment = async () => {
		if (enableState.status !== "verify") {
			return;
		}

		if (enableState.code.length !== TOTP_CODE_LENGTH) {
			dispatch({
				type: "VERIFY_FAILED",
				message: `Enter the ${TOTP_CODE_LENGTH}-digit code from your authenticator app.`,
			});
			return;
		}

		dispatch({ type: "VERIFY_BEGIN" });

		const { error } = await client.twoFactor.verifyTotp({
			code: enableState.code,
		});

		if (error) {
			dispatch({
				type: "VERIFY_FAILED",
				message:
					error.message ??
					"That code didn't match. Try again with a fresh code.",
			});
			return;
		}

		dispatch({ type: "VERIFIED" });
		await refresh();
		toast.success("Two-factor authentication enabled");
	};

	const handleConfirmDisable = async () => {
		setDisableState({ isLoading: true, errorMessage: "" });

		const { error } = await client.twoFactor.disable({});

		if (error) {
			setDisableState({
				isLoading: false,
				errorMessage:
					error.message ??
					"We couldn't disable two-factor authentication. Please try again.",
			});
			return;
		}

		setDisableState({ isLoading: false, errorMessage: "" });
		setDisableOpen(false);
		await refresh();
		toast.success("Two-factor authentication disabled");
	};

	// `enrolmentDialogOpen` drives the Dialog independently of the state
	// machine so that, on close, we can let the close animation play before
	// resetting state — otherwise the step content (especially the QR code)
	// unmounts mid-animation and the dialog visibly collapses before fading.
	const [enrolmentDialogOpen, setEnrolmentDialogOpen] = useState(false);

	useEffect(() => {
		if (
			enableState.status === "scan" ||
			enableState.status === "verify" ||
			enableState.status === "saved"
		) {
			setEnrolmentDialogOpen(true);
		}
	}, [enableState.status]);

	const handleEnrolmentDialogChange = (open: boolean) => {
		setEnrolmentDialogOpen(open);
	};

	const handleEnrolmentDialogChangeComplete = (open: boolean) => {
		if (!open) {
			dispatch({ type: "RESET" });
		}
	};

	const dialogTitle =
		enableState.status === "saved"
			? "Two-factor authentication enabled"
			: "Set up two-factor authentication";

	const dialogDescription =
		enableState.status === "saved"
			? "Save the backup codes below before closing — you won't see them again."
			: "Pair Kayle ID with an authenticator app to add a second sign-in step.";

	return (
		<>
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1.5">
						<CardTitle className="flex items-center gap-2">
							<ShieldCheckIcon className="size-5" />
							Two-factor authentication
							{twoFactorEnabled ? (
								<Badge variant="default">Enabled</Badge>
							) : null}
						</CardTitle>
						<CardDescription>
							Add an extra layer of security with a time-based one-time code
							from an authenticator app.
						</CardDescription>
					</div>
					{twoFactorEnabled ? (
						<Button
							onClick={() => setDisableOpen(true)}
							type="button"
							variant="destructive"
						>
							Disable
						</Button>
					) : (
						<Button
							disabled={enableState.status === "loading"}
							onClick={handleBeginEnrolment}
							type="button"
						>
							{enableState.status === "loading" ? "Generating..." : "Enable"}
						</Button>
					)}
				</CardHeader>
				{!twoFactorEnabled &&
				enableState.status === "idle" &&
				enableState.errorMessage ? (
					<CardContent>
						<Alert variant="destructive">
							<AlertTitle>Couldn't start enrolment</AlertTitle>
							<AlertDescription>{enableState.errorMessage}</AlertDescription>
						</Alert>
					</CardContent>
				) : null}
			</Card>

			<Dialog
				onOpenChange={handleEnrolmentDialogChange}
				onOpenChangeComplete={handleEnrolmentDialogChangeComplete}
				open={enrolmentDialogOpen}
			>
				<DialogContent className="flex w-full max-w-lg! flex-col">
					<DialogHeader>
						<DialogTitle>{dialogTitle}</DialogTitle>
						<DialogDescription>{dialogDescription}</DialogDescription>
					</DialogHeader>
					{enableState.status === "scan" ||
					enableState.status === "verify" ||
					enableState.status === "saved" ? (
						<EnrolmentStepIndicator current={enableState.status} />
					) : null}
					{enableState.status === "scan" ? (
						<ScanStep dispatch={dispatch} state={enableState} />
					) : null}
					{enableState.status === "verify" ? (
						<VerifyStep
							dispatch={dispatch}
							onVerify={handleVerifyEnrolment}
							state={enableState}
						/>
					) : null}
					{enableState.status === "saved" ? (
						<BackupCodesStep codes={enableState.payload.backupCodes} />
					) : null}
					<DialogFooter className="sm:justify-between">
						{enableState.status === "scan" ? (
							<>
								<Button
									onClick={() => setEnrolmentDialogOpen(false)}
									type="button"
									variant="secondary"
								>
									Cancel
								</Button>
								<Button
									onClick={() => dispatch({ type: "GO_TO_VERIFY" })}
									type="button"
								>
									I've scanned it
								</Button>
							</>
						) : null}
						{enableState.status === "verify" ? (
							<>
								<Button
									disabled={enableState.isVerifying}
									onClick={() => dispatch({ type: "GO_TO_SCAN" })}
									type="button"
									variant="secondary"
								>
									Back
								</Button>
								<Button
									disabled={
										enableState.isVerifying ||
										enableState.code.length !== TOTP_CODE_LENGTH
									}
									onClick={handleVerifyEnrolment}
									type="button"
								>
									{enableState.isVerifying ? "Verifying..." : "Verify"}
								</Button>
							</>
						) : null}
						{enableState.status === "saved" ? (
							<Button
								className="ml-auto"
								onClick={() => setEnrolmentDialogOpen(false)}
								type="button"
							>
								Done
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<DisableTwoFactorDialog
				errorMessage={disableState.errorMessage}
				isLoading={disableState.isLoading}
				onConfirm={handleConfirmDisable}
				onOpenChange={(open) => {
					if (!open) {
						setDisableState({ isLoading: false, errorMessage: "" });
					}
					setDisableOpen(open);
				}}
				open={disableOpen}
			/>
		</>
	);
}
