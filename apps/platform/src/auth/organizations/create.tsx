import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import { isOrganizationSlug } from "@kayle-id/auth/organization-slug";
import { Button } from "@kayle-id/ui/components/button";
import { Input } from "@kayle-id/ui/components/input";
import { Logo } from "@kayle-id/ui/components/logo";
import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Loading } from "@/components/loading";
import { requestApiResource } from "@/utils/api-client";
import { getErrorMessage } from "@/utils/get-error-message";

const DEFAULT_ERROR = "Failed to create organization";

export function CreateOrganization() {
	const { refresh } = useAuth();
	const navigate = useNavigate();
	const nameRef = useRef<HTMLInputElement>(null);
	const slugRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState("");
	const [slug, setSlug] = useState("");
	const [created, setCreated] = useState(false);
	const [logoPreview, setLogoPreview] = useState<string | null>(null);
	const [logoBase64, setLogoBase64] = useState<string | null>(null);
	const [logoContentType, setLogoContentType] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");
	const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!slugManuallyEdited && name) {
			const generatedSlug = name
				.toLowerCase()
				.trim()
				.replace(/[^\w\s-]/g, "")
				.replace(/\s+/g, "-")
				.replace(/-+/g, "-");
			setSlug(generatedSlug);
		}
	}, [name, slugManuallyEdited]);

	const handleSlugChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setSlug(value);
		setSlugManuallyEdited(true);
	};

	const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (file) {
			if (!file.type.startsWith("image/")) {
				setError("Please select an image file");
				return;
			}
			setLogoContentType(file.type);
			const reader = new FileReader();
			reader.onloadend = () => {
				const dataUrl = reader.result as string;
				setLogoPreview(dataUrl);
				const base64String = dataUrl.split(",")[1] ?? null;
				setLogoBase64(base64String);
			};
			reader.readAsDataURL(file);
			setError("");
		}
	};

	const handleLogoClick = () => {
		fileInputRef.current?.click();
	};

	const handleRemoveLogo = (e: React.MouseEvent) => {
		e.stopPropagation();
		setLogoPreview(null);
		setLogoBase64(null);
		setLogoContentType(null);
		if (fileInputRef.current) {
			fileInputRef.current.value = "";
		}
	};

	const validateForm = (): boolean => {
		if (!name.trim()) {
			setError("Organization name is required");
			return false;
		}

		if (!slug.trim()) {
			setError("Organization slug is required");
			return false;
		}

		if (!isOrganizationSlug(slug)) {
			setError(
				"Slug must contain only lowercase letters, numbers, and hyphens",
			);
			return false;
		}

		return true;
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (!validateForm()) {
			return;
		}

		setIsLoading(true);

		const logo =
			logoBase64 && logoContentType
				? { data: logoBase64, contentType: logoContentType }
				: undefined;

		try {
			const result = await requestApiResource<{ id: string }>({
				basePath: "/api/auth/orgs",
				body: { name, slug, logo },
				method: "POST",
				unexpectedMessage: DEFAULT_ERROR,
			});

			await client.organization.setActive({
				organizationId: result.id,
				organizationSlug: slug,
			});
			await refresh();

			setCreated(true);
			setTimeout(() => navigate({ to: "/onboarding" }), 1000);
		} catch (err) {
			setError(getErrorMessage(err, `${DEFAULT_ERROR}. Please try again.`));
		} finally {
			setIsLoading(false);
		}
	};

	const handleNameClick = () => {
		nameRef.current?.focus();
	};

	const handleSlugClick = () => {
		slugRef.current?.focus();
	};

	if (created) {
		return <Loading />;
	}

	return (
		<div className="relative flex flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						Create Organization
					</h1>
					<p className="text-pretty text-lg text-muted-foreground">
						Set up your organization to get started with Kayle ID.
					</p>
				</div>

				<div className="rounded-lg border border-border bg-card p-4">
					<div className="flex items-center gap-4">
						<div className="group relative flex h-16 w-16 shrink-0">
							<button
								aria-label="Upload logo"
								className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-border border-dashed bg-muted transition-colors hover:border-foreground/50 hover:bg-muted/80"
								disabled={isLoading}
								onClick={handleLogoClick}
								type="button"
							>
								<input
									accept="image/*"
									className="hidden"
									disabled={isLoading}
									onChange={handleLogoChange}
									ref={fileInputRef}
									type="file"
								/>
								{logoPreview ? (
									<img
										alt="Organization logo"
										className="h-full w-full rounded-lg object-cover"
										height={64}
										src={logoPreview}
										width={64}
									/>
								) : (
									<PlusIcon
										aria-hidden="true"
										className="h-6 w-6 text-muted-foreground"
									/>
								)}
							</button>
							{logoPreview && (
								<button
									aria-label="Remove logo"
									className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
									disabled={isLoading}
									onClick={handleRemoveLogo}
									type="button"
								>
									<XIcon
										aria-hidden="true"
										className="h-3 w-3 text-muted-foreground"
									/>
								</button>
							)}
						</div>

						<div className="min-w-0 flex-1">
							<h3 className="truncate font-medium text-foreground text-lg">
								<button
									aria-label="Edit organization name"
									className="block max-w-full truncate p-0 text-left"
									disabled={isLoading}
									onClick={handleNameClick}
									type="button"
								>
									{name || "My Organization"}
								</button>
							</h3>
							<p className="text-muted-foreground text-sm">
								<button
									aria-label="Edit organization slug"
									className="block max-w-full truncate p-0 text-left"
									disabled={isLoading}
									onClick={handleSlugClick}
									type="button"
								>
									{slug || "my-organization"}
								</button>
							</p>
						</div>
					</div>
				</div>

				<form className="space-y-6" onSubmit={handleSubmit}>
					{error && (
						<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">
							{error}
						</div>
					)}

					<fieldset>
						<legend className="mb-2 text-muted-foreground">
							<span className="text-sm">Organization name</span>
						</legend>
						<Input
							disabled={isLoading}
							id="name"
							onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
								setName(e.target.value)
							}
							placeholder="Acme Inc."
							ref={nameRef}
							required
							type="text"
							value={name}
						/>
					</fieldset>

					<fieldset>
						<legend className="mb-2 text-muted-foreground">
							<span className="text-sm">Organization slug</span>
						</legend>
						<Input
							disabled={isLoading}
							id="slug"
							onChange={handleSlugChange}
							placeholder="acme-inc"
							ref={slugRef}
							required
							type="text"
							value={slug}
						/>
					</fieldset>

					<Button className="w-full" disabled={isLoading} type="submit">
						{isLoading ? "Creating..." : "Create organization"}
					</Button>
				</form>

				<p className="inline-block text-center text-muted-foreground text-xs">
					By creating an organization, you agree to our{" "}
					<Button
						className="inline-block h-fit! p-0 text-foreground text-xs!"
						nativeButton={false}
						render={
							<a href="/terms" rel="noopener noreferrer" target="_blank">
								Terms of Service
							</a>
						}
						variant="link"
					/>{" "}
					and{" "}
					<Button
						className="inline-block h-fit! p-0 text-foreground text-xs!"
						nativeButton={false}
						render={
							<a href="/privacy" rel="noopener noreferrer" target="_blank">
								Privacy Policy
							</a>
						}
						variant="link"
					/>
				</p>
			</div>
		</div>
	);
}
