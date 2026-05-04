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
import { Label } from "@kayleai/ui/label";
import { Separator } from "@kayleai/ui/separator";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2Icon, MailIcon } from "lucide-react";
import { toast } from "sonner";

export function AccountSettingsPage() {
	const { user } = useAuth();

	const sendVerificationMutation = useMutation({
		mutationFn: async () => {
			if (!user?.email) {
				throw new Error("No email address on file");
			}
			const result = await client.sendVerificationEmail({
				email: user.email,
				callbackURL: "/account/settings",
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Failed to send verification email",
				);
			}
		},
	});

	const handleResendVerification = () => {
		toast.promise(sendVerificationMutation.mutateAsync(), {
			loading: "Sending verification email...",
			success: "Verification email sent. Check your inbox.",
			error: (error) =>
				error instanceof Error
					? error.message
					: "Failed to send verification email",
		});
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Email</CardTitle>
					<CardDescription>
						The address used to sign in and receive account notifications.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex items-center gap-3">
							<MailIcon
								aria-hidden="true"
								className="size-4 text-muted-foreground"
							/>
							<div className="flex flex-col">
								<Label className="text-muted-foreground text-sm">
									Email address
								</Label>
								<p className="font-medium">{user?.email ?? "—"}</p>
							</div>
						</div>
						{user?.emailVerified ? (
							<Badge
								className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
								variant="outline"
							>
								<CheckCircle2Icon aria-hidden="true" className="mr-1 size-3" />
								Verified
							</Badge>
						) : (
							<Badge
								className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400"
								variant="outline"
							>
								Unverified
							</Badge>
						)}
					</div>

					{user?.emailVerified ? null : (
						<>
							<Separator />
							<Alert>
								<AlertTitle>Verify your email</AlertTitle>
								<AlertDescription>
									Verifying your email helps us keep your account secure and
									ensures you receive important notifications.
								</AlertDescription>
							</Alert>
							<div className="flex justify-end">
								<Button
									disabled={sendVerificationMutation.isPending}
									onClick={handleResendVerification}
									size="sm"
									type="button"
								>
									{sendVerificationMutation.isPending
										? "Sending..."
										: "Send verification email"}
								</Button>
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle className="text-destructive">Delete account</CardTitle>
					<CardDescription>
						Permanently remove your Kayle ID account and all associated data.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Alert>
						<AlertTitle>Account deletion is handled by support</AlertTitle>
						<AlertDescription>
							Account deletion requires a manual review to comply with our
							identity-verification data-retention policy. Contact support to
							request removal of your account.
						</AlertDescription>
					</Alert>
				</CardContent>
			</Card>
		</div>
	);
}
