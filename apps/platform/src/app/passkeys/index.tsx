import { client } from "@kayle-id/auth/client";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
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
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, TrashIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/utils/format-date";

const PASSKEYS_QUERY_KEY = ["passkeys"] as const;

interface PasskeyRow {
	id: string;
	name?: string | null;
	deviceType: string;
	createdAt: string | Date;
}

async function listPasskeys(): Promise<PasskeyRow[]> {
	const result = await client.passkey.listUserPasskeys();
	if (result?.error) {
		throw new Error(result.error.message ?? "Failed to load passkeys.");
	}
	return (result?.data ?? []) as PasskeyRow[];
}

export function PasskeysList() {
	const queryClient = useQueryClient();
	const { data, isLoading, isError, error } = useQuery({
		queryKey: PASSKEYS_QUERY_KEY,
		queryFn: listPasskeys,
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await client.passkey.deletePasskey({ id });
			if (result?.error) {
				throw new Error(result.error.message ?? "Failed to delete passkey.");
			}
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
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
				{isError ? (
					<Alert variant="destructive">
						<AlertTitle>Failed to load passkeys</AlertTitle>
						<AlertDescription>
							{error instanceof Error ? error.message : "Please try again."}
						</AlertDescription>
					</Alert>
				) : null}

				<div className="overflow-hidden rounded-md border">
					<Table>
						<TableHeader className="bg-muted">
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
										{formatDate(
											typeof passkey.createdAt === "string"
												? passkey.createdAt
												: passkey.createdAt.toISOString(),
										)}
									</TableCell>
									<TableCell className="text-right">
										<Button
											onClick={() =>
												toast.promise(deleteMutation.mutateAsync(passkey.id), {
													loading: "Removing passkey…",
													success: "Passkey removed",
													error: (err) =>
														err instanceof Error
															? err.message
															: "Failed to remove passkey",
												})
											}
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
				setErrorMessage(result.error.message ?? "Failed to add passkey.");
				return;
			}
			await queryClient.invalidateQueries({ queryKey: PASSKEYS_QUERY_KEY });
			toast.success("Passkey added");
			handleOpenChange(false);
		} catch (err) {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to add passkey.",
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
					{errorMessage ? (
						<Alert variant="destructive">
							<AlertTitle>Error</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					) : null}
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
