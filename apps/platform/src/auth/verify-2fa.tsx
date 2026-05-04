import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayleai/ui/button";
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@kayleai/ui/input-otp";
import { Logo } from "@kayleai/ui/logo";
import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

const TOTP_CODE_LENGTH = 6;

type VerifyMode = "totp" | "backup";

export function VerifyTwoFactor() {
	const navigate = useNavigate();
	const { refresh } = useAuth();
	const [mode, setMode] = useState<VerifyMode>("totp");
	const [code, setCode] = useState("");
	const [backupCode, setBackupCode] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	const handleCodeChange = useCallback((value: string) => {
		setCode(value);
	}, []);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();

		const value = mode === "totp" ? code : backupCode.trim();
		if (mode === "totp" && value.length !== TOTP_CODE_LENGTH) {
			setError(`Enter the ${TOTP_CODE_LENGTH}-digit code from your app.`);
			return;
		}

		if (mode === "backup" && value.length === 0) {
			setError("Enter one of your backup codes.");
			return;
		}

		setIsLoading(true);
		setError("");

		const { error: verifyError } =
			mode === "totp"
				? await client.twoFactor.verifyTotp({ code: value })
				: await client.twoFactor.verifyBackupCode({ code: value });

		setIsLoading(false);

		if (verifyError) {
			setError(
				verifyError.message ?? "That code didn't match. Please try again.",
			);
			return;
		}

		await refresh();
		navigate({ to: "/dashboard" });
	};

	return (
		<div className="flex flex-col items-center justify-center">
			<form className="w-full max-w-md space-y-8" onSubmit={handleSubmit}>
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						Two-factor authentication
					</h1>
					<p className="text-pretty text-lg text-muted-foreground">
						{mode === "totp"
							? "Open your authenticator app and enter the 6-digit code."
							: "Enter one of the backup codes you saved when you enabled 2FA."}
					</p>
				</div>

				{error ? (
					<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-600 text-sm">
						{error}
					</div>
				) : null}

				{mode === "totp" ? (
					<fieldset>
						<legend className="mb-2 text-muted-foreground">
							<span className="text-sm">Authenticator code</span>
						</legend>
						<InputOTP
							autoFocus
							containerClassName="w-full"
							disabled={isLoading}
							maxLength={TOTP_CODE_LENGTH}
							onChange={handleCodeChange}
							required
							value={code}
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
				) : (
					<fieldset>
						<legend className="mb-2 text-muted-foreground">
							<span className="text-sm">Backup code</span>
						</legend>
						<input
							autoComplete="one-time-code"
							className="w-full rounded-md border border-border bg-background px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-foreground"
							disabled={isLoading}
							onChange={(event) => setBackupCode(event.target.value)}
							placeholder="xxxx-xxxx"
							value={backupCode}
						/>
					</fieldset>
				)}

				<div className="flex flex-row items-center justify-center gap-3">
					<Button
						className="flex-1"
						disabled={isLoading}
						nativeButton={false}
						render={<Link to="/sign-out">Cancel</Link>}
						variant="secondary"
					>
						Cancel
					</Button>
					<Button
						className="flex-1"
						disabled={
							isLoading ||
							(mode === "totp"
								? code.length !== TOTP_CODE_LENGTH
								: backupCode.trim().length === 0)
						}
						type="submit"
					>
						{isLoading ? "Verifying..." : "Verify"}
					</Button>
				</div>

				<div className="text-center">
					<Button
						className="text-foreground text-sm"
						onClick={() => {
							setMode((current) => (current === "totp" ? "backup" : "totp"));
							setError("");
							setCode("");
							setBackupCode("");
						}}
						type="button"
						variant="link"
					>
						{mode === "totp"
							? "Use a backup code instead"
							: "Use authenticator app instead"}
					</Button>
				</div>
			</form>
		</div>
	);
}
