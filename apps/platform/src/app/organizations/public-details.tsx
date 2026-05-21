import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayle-id/ui/components/button";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import { Textarea } from "@kayle-id/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FormErrorAlert } from "@/components/form-error-alert";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { getErrorMessage } from "@/utils/get-error-message";
import {
	type FullOrganization,
	ORGANIZATION_QUERY_KEY,
	updateOrganization,
	uploadOrganizationLogo,
} from "./api";
import { FormSection } from "./form-section";
import { OrganizationPageLayout } from "./layout";
import {
	getOrganizationLogoFileError,
	ORGANIZATION_LOGO_ACCEPT,
} from "./logo-policy";
import { UnverifiedDomainNotice } from "./unverified-domain-notice";
import {
	useCurrentMemberRole,
	useOrganizationDomainsQuery,
	useOrganizationQuery,
} from "./use-organization-query";
import {
	parsePublicPrivacyPolicyUrl,
	parsePublicTermsOfServiceUrl,
	parsePublicWebsiteUrl,
} from "./website-url";

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

export interface PublicDetailsDraftValues {
	name: string;
	description: string;
	website: string;
	privacyPolicyUrl: string;
	termsOfServiceUrl: string;
	/** Local data URL while a logo is pending, persisted URL otherwise, or null. */
	logoPreview: string | null;
}

export function PublicDetailsForm({
	canEdit,
	compact,
	onSaved,
	onValuesChange,
	organization,
}: {
	canEdit: boolean;
	compact?: boolean;
	onSaved?: () => void;
	// Onboarding preview pane uses this to mirror the user's draft live.
	onValuesChange?: (values: PublicDetailsDraftValues) => void;
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
	const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(
		organization.metadata?.privacyPolicyUrl ?? "",
	);
	const [termsOfServiceUrl, setTermsOfServiceUrl] = useState(
		organization.metadata?.termsOfServiceUrl ?? "",
	);
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
		setPrivacyPolicyUrl(organization.metadata?.privacyPolicyUrl ?? "");
		setTermsOfServiceUrl(organization.metadata?.termsOfServiceUrl ?? "");
		setLogoPreview(organization.logo ?? null);
		setPendingLogo(undefined);
		setErrorMessage("");
	}, [
		organization.name,
		organization.logo,
		organization.metadata?.description,
		organization.metadata?.website,
		organization.metadata?.privacyPolicyUrl,
		organization.metadata?.termsOfServiceUrl,
	]);

	useEffect(() => {
		onValuesChange?.({
			name,
			description,
			website,
			privacyPolicyUrl,
			termsOfServiceUrl,
			logoPreview,
		});
	}, [
		onValuesChange,
		name,
		description,
		website,
		privacyPolicyUrl,
		termsOfServiceUrl,
		logoPreview,
	]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const trimmedName = name.trim();
			const trimmedWebsite = website.trim();
			const trimmedDescription = description.trim();
			const trimmedPrivacyPolicyUrl = privacyPolicyUrl.trim();
			const trimmedTermsOfServiceUrl = termsOfServiceUrl.trim();
			const parsedWebsite = parsePublicWebsiteUrl(trimmedWebsite);
			const parsedPrivacyPolicyUrl = parsePublicPrivacyPolicyUrl(
				trimmedPrivacyPolicyUrl,
			);
			const parsedTermsOfServiceUrl = parsePublicTermsOfServiceUrl(
				trimmedTermsOfServiceUrl,
			);

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
					website: parsedWebsite?.href ?? null,
					privacyPolicyUrl: parsedPrivacyPolicyUrl?.href ?? null,
					termsOfServiceUrl: parsedTermsOfServiceUrl?.href ?? null,
					// Preserve compliance metadata so this update doesn't wipe it.
					legalControllerName:
						organization.metadata?.legalControllerName ?? null,
					controllerJurisdiction:
						organization.metadata?.controllerJurisdiction ?? null,
					supportEmail: organization.metadata?.supportEmail ?? null,
					fallbackIdvUrl: organization.metadata?.fallbackIdvUrl ?? null,
					appealUrl: organization.metadata?.appealUrl ?? null,
					complaintsUrl: organization.metadata?.complaintsUrl ?? null,
					article6Basis: organization.metadata?.article6Basis ?? null,
					article9Condition: organization.metadata?.article9Condition ?? null,
					usesKayleForConsequentialDecisions:
						organization.metadata?.usesKayleForConsequentialDecisions ?? null,
				},
				...(logoPayload === undefined ? {} : { logo: logoPayload }),
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			// In compact (onboarding-wizard) mode the success toast covers the
			// Back / Skip / Continue footer buttons — suppress it there.
			if (!compact) {
				toast.success("Public details updated");
			}
			setErrorMessage("");
			setPendingLogo(undefined);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
			onSaved?.();
		},
		onError: (err) => {
			setErrorMessage(getErrorMessage(err, "Failed to update public details"));
		},
	});

	const handleSelectFile = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) {
			return;
		}
		const logoError = getOrganizationLogoFileError(file);
		if (logoError) {
			setErrorMessage(logoError);
			if (pendingLogo instanceof File) {
				setLogoPreview(organization.logo ?? null);
				setPendingLogo(undefined);
			}
			event.target.value = "";
			return;
		}
		try {
			const dataUrl = await readFileAsDataUrl(file);
			setLogoPreview(dataUrl);
			setPendingLogo(file);
			setErrorMessage("");
		} catch (err) {
			setErrorMessage(
				getErrorMessage(err, "Failed to read the selected file."),
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
	const trimmedPrivacyPolicyUrl = privacyPolicyUrl.trim();
	const trimmedTermsOfServiceUrl = termsOfServiceUrl.trim();
	const isDirty =
		trimmedName !== organization.name ||
		trimmedDescription !== (organization.metadata?.description ?? "") ||
		trimmedWebsite !== (organization.metadata?.website ?? "") ||
		trimmedPrivacyPolicyUrl !==
			(organization.metadata?.privacyPolicyUrl ?? "") ||
		trimmedTermsOfServiceUrl !==
			(organization.metadata?.termsOfServiceUrl ?? "") ||
		pendingLogo !== undefined;

	const isSaving = saveMutation.isPending;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canEdit || isSaving) {
			return;
		}
		if (!trimmedName) {
			setErrorMessage("Name is required");
			return;
		}
		if (trimmedWebsite && !parsePublicWebsiteUrl(trimmedWebsite)) {
			setErrorMessage(
				"Website must be a valid http:// or https:// URL without embedded credentials.",
			);
			return;
		}
		if (
			trimmedPrivacyPolicyUrl &&
			!parsePublicPrivacyPolicyUrl(trimmedPrivacyPolicyUrl)
		) {
			setErrorMessage(
				"Privacy policy link must be a valid http:// or https:// URL without embedded credentials.",
			);
			return;
		}
		if (
			trimmedTermsOfServiceUrl &&
			!parsePublicTermsOfServiceUrl(trimmedTermsOfServiceUrl)
		) {
			setErrorMessage(
				"Terms of service link must be a valid http:// or https:// URL without embedded credentials.",
			);
			return;
		}
		setErrorMessage("");
		// Already-valid + clean state — the onboarding wizard expects Continue
		// to advance even if there's nothing to persist.
		if (!isDirty) {
			onSaved?.();
			return;
		}
		saveMutation.mutate();
	};

	return (
		<form
			className="space-y-6"
			id={compact ? "onboarding-form" : undefined}
			onSubmit={handleSubmit}
		>
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl text-foreground tracking-tight">
					Public details
				</h1>
				<p className="text-muted-foreground text-sm">
					This section lets you customize how your organization appears to users
					while they complete an ID or Age check.
				</p>
			</div>

			<FormErrorAlert message={errorMessage} />

			<FormSection compact={compact}>
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
								accept={ORGANIZATION_LOGO_ACCEPT}
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
								? "Click the placeholder to choose an image."
								: "Only owners and admins can change the logo."}
						</p>
					</div>
				</div>
			</FormSection>

			<FormSection compact={compact}>
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
						Shown to users when they're asked to verify with your organization.
					</p>
				</div>
			</FormSection>

			<FormSection compact={compact}>
				<div className="space-y-2">
					<Label htmlFor="public-privacy-policy">
						Privacy policy URL
						<span aria-hidden="true" className="ml-0.5 text-destructive">
							*
						</span>
						<span className="sr-only"> (required)</span>
					</Label>
					<Input
						aria-required="true"
						autoComplete="url"
						disabled={!canEdit || isSaving}
						id="public-privacy-policy"
						inputMode="url"
						name="privacyPolicyUrl"
						onChange={(event) => setPrivacyPolicyUrl(event.target.value)}
						placeholder="https://acme.example/privacy"
						type="url"
						value={privacyPolicyUrl}
					/>
					<p className="text-muted-foreground text-xs">
						Required before identity checks — your compliance profile depends on
						this link.
					</p>
				</div>
				<div className="space-y-2">
					<Label htmlFor="public-terms-of-service">Terms of service URL</Label>
					<Input
						autoComplete="url"
						disabled={!canEdit || isSaving}
						id="public-terms-of-service"
						inputMode="url"
						name="termsOfServiceUrl"
						onChange={(event) => setTermsOfServiceUrl(event.target.value)}
						placeholder="https://acme.example/terms"
						type="url"
						value={termsOfServiceUrl}
					/>
				</div>
			</FormSection>

			{compact ? null : (
				<div className="flex justify-end">
					<Button disabled={!canEdit || !isDirty || isSaving} type="submit">
						{isSaving ? "Saving..." : "Save changes"}
					</Button>
				</div>
			)}
		</form>
	);
}

export function OrganizationPublicDetailsPage() {
	const { data, isLoading, isError, error } = useOrganizationQuery();
	const domainsQuery = useOrganizationDomainsQuery();
	const currentRole = useCurrentMemberRole();
	const canEdit = currentRole === "owner" || currentRole === "admin";

	const hasActiveVerifiedDomain = (domainsQuery.data?.domains ?? []).some(
		(d) => d.downgradedAt === null,
	);
	const showUnverifiedNotice =
		!domainsQuery.isLoading && !hasActiveVerifiedDomain;

	return (
		<OrganizationPageLayout
			description="Manage what users see when they interact with your organization."
			title="Public details"
		>
			<QueryErrorAlert
				error={isError ? error : null}
				fallback="Something went wrong while loading public details."
				title="Failed to load public details"
			/>
			{showUnverifiedNotice ? (
				<div className="mb-6">
					<UnverifiedDomainNotice hiddenSurfaces="your logo, legal name, jurisdiction, or registration number" />
				</div>
			) : null}
			{isLoading ? <PublicDetailsSkeleton /> : null}
			{data && !isError ? (
				<PublicDetailsForm canEdit={canEdit} organization={data} />
			) : null}
		</OrganizationPageLayout>
	);
}
