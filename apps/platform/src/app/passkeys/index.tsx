import { client } from "@kayle-id/auth/client";
import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayle-id/ui/components/dialog";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayle-id/ui/components/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormErrorAlert } from "@/components/form-error-alert";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { RelativeTime } from "@/components/relative-time";
import { unwrapBetterAuthResult } from "@/utils/better-auth";
import { useToastMutation } from "@/utils/use-toast-mutation";
import { friendlyPasskeyError } from "./errors";

const PASSKEYS_QUERY_KEY = ["passkeys"] as const;

interface PasskeyRow {
	id: string;
	name?: string | null;
	deviceType: string;
	createdAt: string | Date;
}

async function listPasskeys(): Promise<PasskeyRow[]> {
	const result = await client.passkey.listUserPasskeys();
	return unwrapBetterAuthResult(
		result,
		"Failed to load passkeys.",
	) as PasskeyRow[];
}

export function PasskeysList() {
	const { data, isLoading, isError, error } = useQuery({
		queryKey: PASSKEYS_QUERY_KEY,
		queryFn: listPasskeys,
	});

	const deleteMutation = useToastMutation<void, string>({
		mutationFn: async (id) => {
			const result = await client.passkey.deletePasskey({ id });
			if (result?.error) {
				throw new Error(result.error.message ?? "Failed to delete passkey.");
			}
		},
		invalidate: [PASSKEYS_QUERY_KEY],
		messages: {
			loading: "Removing passkey…",
			success: "Passkey removed",
			error: "Failed to remove passkey",
		},
	});

	const passkeys = data ?? [];

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<CardTitle>Passkeys</CardTitle>
						<CardDescription>
							Sign in faster with biometrics, security keys, or your device's
							screen lock.
						</CardDescription>
					</div>
					<AddPasskey />
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<QueryErrorAlert
					error={isError ? error : null}
					fallback="Please try again."
					title="Failed to load passkeys"
				/>

				<div className="overflow-hidden rounded-md border border-border/70">
					<Table>
						<TableHeader className="bg-muted/40">
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Device</TableHead>
								<TableHead>Added</TableHead>
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading ? (
								<TableRow>
									<TableCell
										className="text-center text-muted-foreground"
										colSpan={4}
									>
										Loading…
									</TableCell>
								</TableRow>
							) : null}
							{!isLoading && passkeys.length === 0 ? (
								<TableRow>
									<TableCell
										className="text-center text-muted-foreground"
										colSpan={4}
									>
										No passkeys yet. Add one to sign in without an email link.
									</TableCell>
								</TableRow>
							) : null}
							{passkeys.map((passkey) => (
								<TableRow key={passkey.id}>
									<TableCell className="font-medium">
										<div className="flex items-center gap-2">
											<KeyRoundIcon className="size-4 text-muted-foreground" />
											{passkey.name?.trim() || "Unnamed passkey"}
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground">
										{passkey.deviceType === "singleDevice"
											? "Single device"
											: "Synced"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										<RelativeTime
											iso={
												typeof passkey.createdAt === "string"
													? passkey.createdAt
													: passkey.createdAt.toISOString()
											}
										/>
									</TableCell>
									<TableCell className="text-right">
										<Button
											onClick={() => deleteMutation.trigger(passkey.id)}
											size="icon"
											variant="ghost"
										>
											<TrashIcon className="size-4" />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			</CardContent>
		</Card>
	);
}

function AddPasskey() {
	const [isOpen, setIsOpen] = useState(false);
	const [name, setName] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const queryClient = useQueryClient();

	const reset = () => {
		setName("");
		setErrorMessage("");
		setIsLoading(false);
	};

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open);
		if (!open) {
			setTimeout(reset, 150);
		}
	};

	const handleSubmit = async () => {
		setIsLoading(true);
		setErrorMessage("");
		try {
			const result = await client.passkey.addPasskey({
				name: name.trim() || undefined,
			});
			if (result?.error) {
				setErrorMessage(
					friendlyPasskeyError(
						result.error,
						"register",
						result.error.message ?? "Failed to add passkey.",
					),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
			toast.success("Passkey added");
			handleOpenChange(false);
		} catch (err) {
			setErrorMessage(
				friendlyPasskeyError(err, "register", "Failed to add passkey."),
			);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger render={<Button>Add passkey</Button>} />
			<DialogContent className="flex w-full max-w-md! flex-col">
				<DialogHeader>
					<DialogTitle>Add a passkey</DialogTitle>
				</DialogHeader>
				<div className="space-y-4">
					<FormErrorAlert message={errorMessage} />
					<div className="space-y-2">
						<Label htmlFor="passkey-name">Name (optional)</Label>
						<Input
							disabled={isLoading}
							id="passkey-name"
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									handleSubmit();
								}
							}}
							placeholder="MacBook Pro"
							value={name}
						/>
						<p className="text-muted-foreground text-xs">
							Choose a label so you can recognise this passkey later.
						</p>
					</div>
				</div>
				<DialogFooter>
					<Button disabled={isLoading} onClick={handleSubmit}>
						{isLoading ? "Waiting for passkey…" : "Continue"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
