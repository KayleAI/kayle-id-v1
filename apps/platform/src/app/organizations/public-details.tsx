import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
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
import { Skeleton } from "@kayleai/ui/skeleton";
import { Textarea } from "@kayleai/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type FullOrganization,
	fetchFullOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
	updateOrganization,
	uploadOrganizationLogo,
} from "./api";
import { OrganizationPageLayout } from "./layout";

const HTTPS_REGEX = /^https?:\/\//i;
const MAX_LOGO_BYTES = 1024 * 1024;

function PublicDetailsSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-44 w-full" />
			<Skeleton className="h-72 w-full" />
		</div>
	);
}

function readFileAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () =>
			reject(new Error("Failed to read the selected file."));
		reader.onload = () => resolve(reader.result as string);
		reader.readAsDataURL(file);
	});
}

function PublicDetailsForm({
	canEdit,
	organization,
}: {
	canEdit: boolean;
	organization: FullOrganization;
}) {
	const queryClient = useQueryClient();
	const { refresh } = useAuth();
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [name, setName] = useState(organization.name);
	const [description, setDescription] = useState(
		organization.metadata?.description ?? "",
	);
	const [website, setWebsite] = useState(organization.metadata?.website ?? "");
	const [logoPreview, setLogoPreview] = useState<string | null>(
		organization.logo ?? null,
	);
	const [pendingLogo, setPendingLogo] = useState<File | null | undefined>(
		undefined,
	);
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		setName(organization.name);
		setDescription(organization.metadata?.description ?? "");
		setWebsite(organization.metadata?.website ?? "");
		setLogoPreview(organization.logo ?? null);
		setPendingLogo(undefined);
		setErrorMessage("");
	}, [
		organization.name,
		organization.logo,
		organization.metadata?.description,
		organization.metadata?.website,
	]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const trimmedName = name.trim();
			const trimmedWebsite = website.trim();
			const trimmedDescription = description.trim();

			let logoPayload: string | undefined;
			if (pendingLogo === null) {
				logoPayload = "";
			} else if (pendingLogo instanceof File) {
				const dataUrl = await readFileAsDataUrl(pendingLogo);
				const base64 = dataUrl.split(",")[1] ?? "";
				const { logo } = await uploadOrganizationLogo({
					contentType: pendingLogo.type,
					data: base64,
				});
				logoPayload = logo;
			}

			await updateOrganization(organization.id, {
				name: trimmedName,
				metadata: {
					description: trimmedDescription ? trimmedDescription : null,
					website: trimmedWebsite ? trimmedWebsite : null,
				},
				...(logoPayload === undefined ? {} : { logo: logoPayload }),
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			toast.success("Public details updated");
			setErrorMessage("");
			setPendingLogo(undefined);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to update public details",
			);
		},
	});

	const handleSelectFile = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}
		if (!file.type.startsWith("image/")) {
			setErrorMessage("Please select an image file.");
			return;
		}
		if (file.size > MAX_LOGO_BYTES) {
			setErrorMessage("Logo must be 1 MB or smaller.");
			return;
		}
		try {
			const dataUrl = await readFileAsDataUrl(file);
			setLogoPreview(dataUrl);
			setPendingLogo(file);
			setErrorMessage("");
		} catch (err) {
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Failed to read the selected file.",
			);
		}
	};

	const handleRemoveLogo = () => {
		setLogoPreview(null);
		setPendingLogo(null);
		setErrorMessage("");
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const trimmedName = name.trim();
	const trimmedWebsite = website.trim();
	const trimmedDescription = description.trim();
	const isDirty =
		trimmedName !== organization.name ||
		trimmedDescription !== (organization.metadata?.description ?? "") ||
		trimmedWebsite !== (organization.metadata?.website ?? "") ||
		pendingLogo !== undefined;

	const isSaving = saveMutation.isPending;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canEdit || !isDirty || isSaving) {
			return;
		}
		if (!trimmedName) {
			setErrorMessage("Name is required");
			return;
		}
		if (trimmedWebsite && !HTTPS_REGEX.test(trimmedWebsite)) {
			setErrorMessage("Website must start with http:// or https://");
			return;
		}
		setErrorMessage("");
		saveMutation.mutate();
	};

	return (
		<form className="space-y-6" onSubmit={handleSubmit}>
			{errorMessage ? (
				<Alert variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			) : null}

			<Card>
				<CardHeader>
					<CardTitle>Logo</CardTitle>
					<CardDescription>
						Shown to users during verification flows. PNG, JPEG, GIF, or WebP up
						to 1 MiB.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-4">
						<div className="group relative flex size-16 shrink-0">
							<button
								aria-label={logoPreview ? "Replace logo" : "Upload logo"}
								className="flex size-16 items-center justify-center rounded-lg border-2 border-border border-dashed bg-muted transition-colors hover:border-foreground/50 hover:bg-muted/80"
								disabled={!canEdit || isSaving}
								onClick={() => fileInputRef.current?.click()}
								type="button"
							>
								<input
									accept="image/*"
									className="hidden"
									disabled={!canEdit || isSaving}
									onChange={handleSelectFile}
									ref={fileInputRef}
									type="file"
								/>
								{logoPreview ? (
									<img
										alt={`${organization.name} logo`}
										className="size-full rounded-lg object-cover"
										height={64}
										src={logoPreview}
										width={64}
									/>
								) : (
									<PlusIcon
										aria-hidden="true"
										className="size-6 text-muted-foreground"
									/>
								)}
							</button>
							{canEdit && logoPreview ? (
								<button
									aria-label="Remove logo"
									className="-top-2 -right-2 absolute flex size-6 items-center justify-center rounded-full border border-border bg-background shadow-sm"
									disabled={isSaving}
									onClick={handleRemoveLogo}
									type="button"
								>
									<XIcon
										aria-hidden="true"
										className="size-3 text-muted-foreground"
									/>
								</button>
							) : null}
						</div>
						<div className="min-w-0 flex-1">
							<p className="font-medium text-foreground text-sm">
								{logoPreview ? "Replace logo" : "Upload a logo"}
							</p>
							<p className="text-muted-foreground text-sm">
								{canEdit
									? "Click the placeholder to choose an image. Changes apply when you save."
									: "Only owners and admins can change the logo."}
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Profile</CardTitle>
					<CardDescription>
						How your organization appears to users during verification.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="public-name">Display name</Label>
						<Input
							disabled={!canEdit || isSaving}
							id="public-name"
							name="name"
							onChange={(event) => setName(event.target.value)}
							placeholder="Acme Inc."
							value={name}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="public-website">Website</Label>
						<Input
							autoComplete="url"
							disabled={!canEdit || isSaving}
							id="public-website"
							inputMode="url"
							name="website"
							onChange={(event) => setWebsite(event.target.value)}
							placeholder="https://acme.example"
							type="url"
							value={website}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="public-description">Description</Label>
						<Textarea
							disabled={!canEdit || isSaving}
							id="public-description"
							name="description"
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Tell users a little about your organization."
							rows={4}
							value={description}
						/>
						<p className="text-muted-foreground text-xs">
							Shown to users when they're asked to verify with your
							organization.
						</p>
					</div>
				</CardContent>
			</Card>

			<div className="flex justify-end">
				<Button disabled={!canEdit || !isDirty || isSaving} type="submit">
					{isSaving ? "Saving..." : "Save changes"}
				</Button>
			</div>
		</form>
	);
}

export function OrganizationPublicDetailsPage() {
	const { user } = useAuth();
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = data?.members.find((member) => member.userId === user?.id)
		?.role as OrganizationRole | undefined;
	const canEdit = currentRole === "owner" || currentRole === "admin";

	return (
		<OrganizationPageLayout
			description="Manage what users see when they interact with your organization."
			title="Public details"
		>
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load public details</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading public details."}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading ? <PublicDetailsSkeleton /> : null}
			{data && !isError ? (
				<PublicDetailsForm canEdit={canEdit} organization={data} />
			) : null}
		</OrganizationPageLayout>
	);
}
