import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Badge } from "@kayleai/ui/badge";
import { Button } from "@kayleai/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
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
import { Label } from "@kayleai/ui/label";
import { CheckCircle2Icon, ShieldCheckIcon } from "lucide-react";
import { useReducer, useState } from "react";
import { toast } from "sonner";
import { useCopyToClipboard } from "@/utils/use-copy";

const TOTP_CODE_LENGTH = 6;

interface EnrolmentPayload {
	totpURI: string;
	secret: string;
	backupCodes: string[];
}

type EnableState =
	| { status: "idle"; errorMessage: string }
	| { status: "loading"; errorMessage: string }
	| {
			status: "verifying";
			errorMessage: string;
			payload: EnrolmentPayload;
			code: string;
	  }
	| {
			status: "saved";
			errorMessage: string;
			payload: EnrolmentPayload;
	  };

type EnableAction =
	| { type: "BEGIN" }
	| { type: "RECEIVE_PAYLOAD"; payload: EnrolmentPayload }
	| { type: "SET_CODE"; code: string }
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
				status: "verifying",
				errorMessage: "",
				payload: action.payload,
				code: "",
			};
		case "SET_CODE":
			if (state.status !== "verifying") {
				return state;
			}
			return { ...state, code: action.code, errorMessage: "" };
		case "VERIFY_FAILED":
			if (state.status !== "verifying") {
				return state;
			}
			return { ...state, errorMessage: action.message };
		case "VERIFIED":
			if (state.status !== "verifying") {
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

function parseSecretFromTotpUri(uri: string): string {
	try {
		const parsed = new URL(uri);
		return parsed.searchParams.get("secret") ?? "";
	} catch {
		return "";
	}
}

function CopyableField({ label, value }: { label: string; value: string }) {
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="space-y-2">
			<Label className="font-medium text-sm">{label}</Label>
			<div className="relative">
				<Input className="pr-20 font-mono text-sm" readOnly value={value} />
				<Button
					className="absolute top-1/2 right-2 -translate-y-1/2"
					onClick={() => copy(value)}
					size="sm"
					type="button"
					variant="outline"
				>
					{copied ? "Copied!" : "Copy"}
				</Button>
			</div>
		</div>
	);
}

function BackupCodesPanel({ codes }: { codes: string[] }) {
	const { copied, copy } = useCopyToClipboard();
	const formatted = codes.join("\n");

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-3">
				<Label className="font-medium text-sm">Backup codes</Label>
				<Button
					onClick={() => copy(formatted)}
					size="sm"
					type="button"
					variant="outline"
				>
					{copied ? "Copied!" : "Copy all"}
				</Button>
			</div>
			<div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/40 p-3 font-mono text-sm">
				{codes.map((code) => (
					<span className="select-all" key={code}>
						{code}
					</span>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				Each code can be used once. Store them somewhere safe — they're your
				only way back in if you lose access to your authenticator app.
			</p>
		</div>
	);
}

function EnableEnrolmentBody({
	state,
	dispatch,
	onVerify,
}: {
	state: Extract<EnableState, { status: "verifying" }>;
	dispatch: React.Dispatch<EnableAction>;
	onVerify: () => void;
}) {
	const secret = parseSecretFromTotpUri(state.payload.totpURI);

	return (
		<div className="space-y-5">
			<div className="space-y-2">
				<p className="text-muted-foreground text-sm">
					Add Kayle ID to your authenticator app by scanning the QR-code URI
					below or pasting the secret manually. Then enter the 6-digit code your
					app generates to confirm enrolment.
				</p>
			</div>
			<CopyableField label="Authenticator URI" value={state.payload.totpURI} />
			<CopyableField label="Secret (manual entry)" value={secret} />
			<BackupCodesPanel codes={state.payload.backupCodes} />
			{state.errorMessage ? (
				<Alert variant="destructive">
					<AlertTitle>Verification failed</AlertTitle>
					<AlertDescription>{state.errorMessage}</AlertDescription>
				</Alert>
			) : null}
			<div className="space-y-2">
				<Label htmlFor="totp-code">Verification code</Label>
				<Input
					autoComplete="one-time-code"
					id="totp-code"
					inputMode="numeric"
					maxLength={TOTP_CODE_LENGTH}
					onChange={(event) =>
						dispatch({ type: "SET_CODE", code: event.target.value.trim() })
					}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							state.code.length === TOTP_CODE_LENGTH
						) {
							onVerify();
						}
					}}
					placeholder="123456"
					value={state.code}
				/>
			</div>
		</div>
	);
}

function EnabledStateView({ onDisable }: { onDisable: () => void }) {
	return (
		<>
			<CardContent className="flex items-center gap-3">
				<div className="flex size-10 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
					<CheckCircle2Icon className="size-5" />
				</div>
				<div className="flex flex-col">
					<span className="font-medium text-sm">Authenticator app enabled</span>
					<span className="text-muted-foreground text-xs">
						You'll be asked for a 6-digit code each time you sign in.
					</span>
				</div>
			</CardContent>
			<CardFooter className="justify-end">
				<Button onClick={onDisable} variant="destructive">
					Disable two-factor authentication
				</Button>
			</CardFooter>
		</>
	);
}

function DisabledStateView({
	state,
	onBegin,
}: {
	state: EnableState;
	onBegin: () => void;
}) {
	return (
		<>
			<CardContent className="space-y-3">
				<p className="text-muted-foreground text-sm">
					Pair Kayle ID with an authenticator app like 1Password, Authy, or
					Google Authenticator. We'll require a 6-digit code on every sign-in
					after enrolment.
				</p>
				{state.status === "idle" && state.errorMessage ? (
					<Alert variant="destructive">
						<AlertTitle>Couldn't start enrolment</AlertTitle>
						<AlertDescription>{state.errorMessage}</AlertDescription>
					</Alert>
				) : null}
			</CardContent>
			<CardFooter className="justify-end">
				<Button disabled={state.status === "loading"} onClick={onBegin}>
					{state.status === "loading"
						? "Generating secret..."
						: "Enable two-factor authentication"}
				</Button>
			</CardFooter>
		</>
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

		dispatch({
			type: "RECEIVE_PAYLOAD",
			payload: {
				totpURI: data.totpURI,
				secret: parseSecretFromTotpUri(data.totpURI),
				backupCodes: data.backupCodes,
			},
		});
	};

	const handleVerifyEnrolment = async () => {
		if (enableState.status !== "verifying") {
			return;
		}

		if (enableState.code.length !== TOTP_CODE_LENGTH) {
			dispatch({
				type: "VERIFY_FAILED",
				message: `Enter the ${TOTP_CODE_LENGTH}-digit code from your authenticator app.`,
			});
			return;
		}

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

	const handleEnrolmentDialogChange = (open: boolean) => {
		if (!open) {
			dispatch({ type: "RESET" });
		}
	};

	const handleSavedDialogChange = (open: boolean) => {
		if (!open) {
			dispatch({ type: "RESET" });
		}
	};

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<ShieldCheckIcon className="size-5" />
						Two-factor authentication
						{twoFactorEnabled ? <Badge variant="default">Enabled</Badge> : null}
					</CardTitle>
					<CardDescription>
						Add an extra layer of security with a time-based one-time code from
						an authenticator app.
					</CardDescription>
				</CardHeader>
				{twoFactorEnabled ? (
					<EnabledStateView onDisable={() => setDisableOpen(true)} />
				) : (
					<DisabledStateView
						onBegin={handleBeginEnrolment}
						state={enableState}
					/>
				)}
			</Card>

			<Dialog
				onOpenChange={handleEnrolmentDialogChange}
				open={enableState.status === "verifying"}
			>
				<DialogContent className="flex w-full max-w-lg! flex-col">
					<DialogHeader>
						<DialogTitle>Set up your authenticator app</DialogTitle>
						<DialogDescription>
							Save the backup codes somewhere safe before continuing — you won't
							see them again.
						</DialogDescription>
					</DialogHeader>
					{enableState.status === "verifying" ? (
						<EnableEnrolmentBody
							dispatch={dispatch}
							onVerify={handleVerifyEnrolment}
							state={enableState}
						/>
					) : null}
					<DialogFooter>
						<Button
							onClick={() => dispatch({ type: "RESET" })}
							variant="secondary"
						>
							Cancel
						</Button>
						<Button
							disabled={
								enableState.status !== "verifying" ||
								enableState.code.length !== TOTP_CODE_LENGTH
							}
							onClick={handleVerifyEnrolment}
						>
							Verify and enable
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog
				onOpenChange={handleSavedDialogChange}
				open={enableState.status === "saved"}
			>
				<DialogContent className="flex w-full max-w-lg! flex-col">
					<DialogHeader>
						<DialogTitle>Two-factor authentication is on</DialogTitle>
						<DialogDescription>
							Save your backup codes now if you haven't already. They're the
							only way back in if you lose access to your authenticator app.
						</DialogDescription>
					</DialogHeader>
					{enableState.status === "saved" ? (
						<BackupCodesPanel codes={enableState.payload.backupCodes} />
					) : null}
					<DialogFooter>
						<Button onClick={() => dispatch({ type: "RESET" })}>Done</Button>
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
