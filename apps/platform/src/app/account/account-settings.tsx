import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import {
	isAllowedProfileImageMime,
	MAX_PROFILE_IMAGE_BYTES,
	normalizeProfileImage,
} from "@kayle-id/auth/profile-image";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kayleai/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
import { Badge } from "@kayleai/ui/badge";
import { Button } from "@kayleai/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Separator } from "@kayleai/ui/separator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { RelativeTime } from "@/components/relative-time";
import {
	listOwnedOrganizations,
	OWNED_ORGS_QUERY_KEY,
	type OwnedOrganization,
} from "./api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

interface UpdateProfileInput {
	name: string;
	image?: string | null;
}

async function readFileAsDataUrl(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(new Error("Could not read image file"));
		reader.readAsDataURL(file);
	});
}

export function AccountSettingsPage() {
	const { user, refresh } = useAuth();

	const [name, setName] = useState(user?.name ?? "");
	const [imagePreview, setImagePreview] = useState<string | null>(
		user?.image ?? null,
	);
	const [pendingImage, setPendingImage] = useState<string | null | undefined>(
		undefined,
	);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setName(user?.name ?? "");
		setImagePreview(user?.image ?? null);
		setPendingImage(undefined);
	}, [user?.name, user?.image]);

	const updateMutation = useMutation({
		mutationFn: async (input: UpdateProfileInput) => {
			const payload: { name?: string; image?: string | null } = {};
			if (input.name !== user?.name) {
				payload.name = input.name;
			}
			if (input.image !== undefined) {
				payload.image = input.image;
			}

			const result = await client.updateUser(payload);

			if (result.error) {
				throw new Error(result.error.message ?? "Failed to update profile");
			}
		},
		onSuccess: async () => {
			await refresh();
			setPendingImage(undefined);
		},
	});

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}

		if (!isAllowedProfileImageMime(file.type)) {
			toast.error("Please select a PNG, JPEG, GIF, or WebP image");
			return;
		}

		if (file.size > MAX_PROFILE_IMAGE_BYTES) {
			toast.error("Image must be 1 MB or smaller");
			return;
		}

		try {
			const dataUrl = await readFileAsDataUrl(file);
			normalizeProfileImage(dataUrl);
			setImagePreview(dataUrl);
			setPendingImage(dataUrl);
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not read image",
			);
		}
	};

	const handleRemoveImage = () => {
		setImagePreview(null);
		setPendingImage(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const trimmedName = name.trim();
	const nameChanged = trimmedName !== (user?.name ?? "");
	const imageChanged = pendingImage !== undefined;
	const hasProfileChanges =
		(nameChanged && trimmedName.length > 0) || imageChanged;
	const isSavingProfile = updateMutation.isPending;

	const handleProfileSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!hasProfileChanges || !trimmedName) {
			return;
		}

		toast.promise(
			updateMutation.mutateAsync({
				name: trimmedName,
				image: imageChanged ? pendingImage : undefined,
			}),
			{
				loading: "Updating profile...",
				success: "Profile updated",
				error: (error) =>
					error instanceof Error ? error.message : "Failed to update profile",
			},
		);
	};

	const initial = (
		user?.name?.charAt(0) ||
		user?.email?.charAt(0) ||
		"U"
	).toUpperCase();

	return (
		<div className="space-y-6">
			{updateMutation.isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to update profile</AlertTitle>
					<AlertDescription>
						{updateMutation.error instanceof Error
							? updateMutation.error.message
							: "Something went wrong. Please try again."}
					</AlertDescription>
				</Alert>
			) : null}

			<form className="space-y-6" onSubmit={handleProfileSubmit}>
				<Card>
					<CardHeader>
						<CardTitle>Profile</CardTitle>
						<CardDescription>
							Your name and avatar are visible to teammates inside your
							organization.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<div className="flex items-center gap-4">
							<Avatar className="size-16 rounded-lg">
								<AvatarImage
									alt={user?.name ?? "Profile picture"}
									src={imagePreview ?? undefined}
								/>
								<AvatarFallback className="rounded-full text-lg">
									{initial}
								</AvatarFallback>
							</Avatar>
							<div className="flex flex-col gap-2">
								<div className="flex flex-wrap gap-2">
									<Button
										disabled={isSavingProfile}
										onClick={() => fileInputRef.current?.click()}
										size="sm"
										type="button"
										variant="outline"
									>
										{imagePreview ? "Replace photo" : "Upload photo"}
									</Button>
									{imagePreview ? (
										<Button
											disabled={isSavingProfile}
											onClick={handleRemoveImage}
											size="sm"
											type="button"
											variant="ghost"
										>
											Remove
										</Button>
									) : null}
								</div>
								<p className="text-muted-foreground text-xs">
									PNG, JPG, GIF, or WebP. Max 1 MB.
								</p>
								<input
									accept="image/png,image/jpeg,image/gif,image/webp"
									className="hidden"
									name="image"
									onChange={handleFileChange}
									ref={fileInputRef}
									type="file"
								/>
							</div>
						</div>

						<Separator />

						<div className="space-y-2">
							<Label htmlFor="name">Name</Label>
							<Input
								autoComplete="name"
								disabled={isSavingProfile}
								id="name"
								name="name"
								onChange={(event) => setName(event.target.value)}
								placeholder="Your name"
								required
								value={name}
							/>
						</div>
					</CardContent>
				</Card>

				<div className="flex justify-end">
					<Button
						disabled={!hasProfileChanges || !trimmedName || isSavingProfile}
						type="submit"
					>
						{isSavingProfile ? "Saving..." : "Save changes"}
					</Button>
				</div>
			</form>

			<EmailCard />

			<Card>
				<CardHeader>
					<CardTitle>Account information</CardTitle>
					<CardDescription>
						Read-only details about your account.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-2">
					<div className="space-y-1">
						<Label className="text-muted-foreground text-sm">Account ID</Label>
						<p className="font-medium font-mono text-sm">{user?.id ?? "—"}</p>
					</div>
					<div className="space-y-1">
						<Label className="text-muted-foreground text-sm">
							Member since
						</Label>
						<p className="font-medium">
							{user?.createdAt ? (
								<RelativeTime iso={new Date(user.createdAt).toISOString()} />
							) : (
								"—"
							)}
						</p>
					</div>
				</CardContent>
			</Card>

			<DeleteAccountCard />
		</div>
	);
}

function EmailCard() {
	const { user } = useAuth();
	const newEmailId = useId();
	const [isEditing, setIsEditing] = useState(false);
	const [newEmail, setNewEmail] = useState("");

	const sendVerificationMutation = useMutation({
		mutationFn: async () => {
			if (!user?.email) {
				throw new Error("No email address on file");
			}
			const result = await client.sendVerificationEmail({
				email: user.email,
				callbackURL: "/account",
			});
			if (result.error) {
				throw new Error(
					result.error.message ?? "Failed to send verification email",
				);
			}
		},
	});

	const changeEmailMutation = useMutation({
		mutationFn: async (next: string) => {
			const result = await client.changeEmail({
				newEmail: next,
				callbackURL: "/account",
			});
			if (result.error) {
				throw new Error(result.error.message ?? "Failed to change email");
			}
			return next;
		},
		onSuccess: () => {
			setIsEditing(false);
			setNewEmail("");
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

	const trimmedNewEmail = newEmail.trim().toLowerCase();
	const newEmailValid = EMAIL_PATTERN.test(trimmedNewEmail);
	const newEmailDifferent =
		!!user?.email && trimmedNewEmail !== user.email.toLowerCase();
	const canSubmitEmail =
		newEmailValid && newEmailDifferent && !changeEmailMutation.isPending;

	const handleEmailSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canSubmitEmail) {
			return;
		}

		toast.promise(changeEmailMutation.mutateAsync(trimmedNewEmail), {
			loading: "Sending confirmation link...",
			success: `Confirmation link sent to ${trimmedNewEmail}. Click it to apply the change.`,
			error: (error) =>
				error instanceof Error ? error.message : "Failed to change email",
		});
	};

	const handleCancelEdit = () => {
		setIsEditing(false);
		setNewEmail("");
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Email</CardTitle>
				<CardDescription>
					The address used to sign in and receive account notifications.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<Label className="text-muted-foreground text-sm">
							Current email
							{user?.emailVerified ? (
								<Badge
									className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400"
									variant="outline"
								>
									<CheckCircle2Icon
										aria-hidden="true"
										className="mr-1 size-3"
									/>
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
						</Label>
						<p className="font-medium">{user?.email ?? "—"}</p>
					</div>
					<div className="flex items-center gap-2">
						{isEditing ? null : (
							<Button
								onClick={() => setIsEditing(true)}
								size="sm"
								type="button"
								variant="outline"
							>
								Change email
							</Button>
						)}
					</div>
				</div>

				{isEditing ? (
					<>
						<Separator />
						<form className="space-y-4" onSubmit={handleEmailSubmit}>
							<div className="space-y-2">
								<Label htmlFor={newEmailId}>New email address</Label>
								<Input
									autoComplete="email"
									autoFocus
									disabled={changeEmailMutation.isPending}
									id={newEmailId}
									onChange={(event) => setNewEmail(event.target.value)}
									placeholder="you@example.com"
									required
									type="email"
									value={newEmail}
								/>
								<p className="text-muted-foreground text-xs">
									We'll send a confirmation link to the new address. The change
									only applies after you click that link.
								</p>
							</div>
							<div className="flex justify-end gap-2">
								<Button
									disabled={changeEmailMutation.isPending}
									onClick={handleCancelEdit}
									size="sm"
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
								<Button disabled={!canSubmitEmail} size="sm" type="submit">
									{changeEmailMutation.isPending
										? "Sending..."
										: "Send confirmation link"}
								</Button>
							</div>
						</form>
					</>
				) : null}

				{user?.emailVerified || isEditing ? null : (
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
	);
}

function DeleteAccountCard() {
	const { user } = useAuth();
	const confirmInputId = useId();
	const [isDialogOpen, setIsDialogOpen] = useState(false);
	const [confirmation, setConfirmation] = useState("");

	const ownedOrgsQuery = useQuery({
		enabled: !!user?.id,
		queryFn: listOwnedOrganizations,
		queryKey: OWNED_ORGS_QUERY_KEY,
		staleTime: 60_000,
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const result = await client.deleteUser({ callbackURL: "/" });
			if (result.error) {
				throw new Error(result.error.message ?? "Failed to delete account");
			}
		},
		onSuccess: () => {
			setIsDialogOpen(false);
			setConfirmation("");
		},
	});

	const handleOpenChange = (next: boolean) => {
		if (deleteMutation.isPending) {
			return;
		}
		setIsDialogOpen(next);
		if (!next) {
			setConfirmation("");
		}
	};

	const handleConfirmDelete = () => {
		toast.promise(deleteMutation.mutateAsync(), {
			loading: "Sending confirmation link...",
			success:
				"Confirmation link sent to your inbox. Click it to permanently delete your account.",
			error: (error) =>
				error instanceof Error ? error.message : "Failed to delete account",
		});
	};

	const expectedConfirmation = user?.email?.toLowerCase() ?? "";
	const confirmationMatches =
		expectedConfirmation.length > 0 &&
		confirmation.trim().toLowerCase() === expectedConfirmation;
	const ownedOrgs: OwnedOrganization[] = ownedOrgsQuery.data ?? [];

	return (
		<>
			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1.5">
						<CardTitle className="text-destructive">Delete account</CardTitle>
						<CardDescription>
							Once deleted, your account and any organizations you solely own
							cannot be recovered.
						</CardDescription>
					</div>
					<Button
						disabled={!user?.email || deleteMutation.isPending}
						onClick={() => setIsDialogOpen(true)}
						type="button"
						variant="destructive"
					>
						Delete account
					</Button>
				</CardHeader>
			</Card>

			<AlertDialog onOpenChange={handleOpenChange} open={isDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete your account?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes your Kayle ID account, sign-in history,
							and any active sessions. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>

					{ownedOrgs.length > 0 ? (
						<Alert variant="destructive">
							<AlertTitle>
								{ownedOrgs.length === 1
									? "1 organization will also be deleted"
									: `${ownedOrgs.length} organizations will also be deleted`}
							</AlertTitle>
							<AlertDescription>
								<p className="mb-2">
									You're the only owner of the following. They — and everything
									inside them (API keys, webhooks, members, invitations) — will
									be permanently deleted.
								</p>
								<ul className="ml-5 list-disc space-y-1">
									{ownedOrgs.map((org) => (
										<li key={org.id}>
											<span className="font-medium">{org.name}</span>{" "}
											<span className="text-muted-foreground">
												({org.slug})
											</span>
										</li>
									))}
								</ul>
								<p className="mt-2">
									To keep an organization, contact support to transfer ownership
									before deleting your account.
								</p>
							</AlertDescription>
						</Alert>
					) : null}

					<div className="space-y-2">
						<Label htmlFor={confirmInputId}>
							Type{" "}
							<span className="font-medium text-foreground">{user?.email}</span>{" "}
							to confirm
						</Label>
						<Input
							autoComplete="off"
							disabled={deleteMutation.isPending}
							id={confirmInputId}
							onChange={(event) => setConfirmation(event.target.value)}
							placeholder={user?.email ?? ""}
							spellCheck={false}
							type="email"
							value={confirmation}
						/>
					</div>

					<AlertDialogFooter>
						<AlertDialogCancel
							disabled={deleteMutation.isPending}
							variant="secondary"
						>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!confirmationMatches || deleteMutation.isPending}
							onClick={handleConfirmDelete}
							variant="destructive"
						>
							{deleteMutation.isPending
								? "Sending..."
								: "Send confirmation link"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
