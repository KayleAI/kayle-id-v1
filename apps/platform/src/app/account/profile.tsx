import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@kayleai/ui/avatar";
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
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDate } from "@/utils/format-date";

const MAX_IMAGE_BYTES = 1024 * 1024;

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

export function ProfilePage() {
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

		if (!file.type.startsWith("image/")) {
			toast.error("Please select an image file");
			return;
		}

		if (file.size > MAX_IMAGE_BYTES) {
			toast.error("Image must be 1 MB or smaller");
			return;
		}

		try {
			const dataUrl = await readFileAsDataUrl(file);
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
	const hasChanges = (nameChanged && trimmedName.length > 0) || imageChanged;
	const isSaving = updateMutation.isPending;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!hasChanges || !trimmedName) {
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
		<form className="space-y-6" onSubmit={handleSubmit}>
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
							<AvatarFallback className="rounded-lg text-lg">
								{initial}
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col gap-2">
							<div className="flex flex-wrap gap-2">
								<Button
									disabled={isSaving}
									onClick={() => fileInputRef.current?.click()}
									size="sm"
									type="button"
									variant="outline"
								>
									{imagePreview ? "Replace photo" : "Upload photo"}
								</Button>
								{imagePreview ? (
									<Button
										disabled={isSaving}
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
								PNG, JPG, or GIF. Max 1 MB.
							</p>
							<input
								accept="image/*"
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
							disabled={isSaving}
							id="name"
							name="name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Your name"
							required
							value={name}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input
							disabled
							id="email"
							name="email"
							readOnly
							type="email"
							value={user?.email ?? ""}
						/>
						<p className="text-muted-foreground text-xs">
							To change your email address, contact support.
						</p>
					</div>
				</CardContent>
			</Card>

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
							{user?.createdAt
								? formatDate(new Date(user.createdAt).toISOString())
								: "—"}
						</p>
					</div>
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button
					disabled={!hasChanges || !trimmedName || isSaving}
					type="submit"
				>
					{isSaving ? "Saving..." : "Save changes"}
				</Button>
			</div>
		</form>
	);
}
