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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kayleai/ui/select";
import { Skeleton } from "@kayleai/ui/skeleton";
import { Textarea } from "@kayleai/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	type FullOrganization,
	fetchFullOrganization,
	listOrganizationDomains,
	ORGANIZATION_DOMAINS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
	updateOrganization,
	uploadOrganizationLogo,
} from "./api";
import { OrganizationPageLayout } from "./layout";
import {
	parsePublicAppealUrl,
	parsePublicComplaintsUrl,
	parsePublicFallbackIdvUrl,
	parsePublicPrivacyPolicyUrl,
	parsePublicSupportEmail,
	parsePublicTermsOfServiceUrl,
	parsePublicWebsiteUrl,
} from "./website-url";

const MAX_LOGO_BYTES = 1024 * 1024;
type ConsequentialUseValue = "no" | "unset" | "yes";

function toConsequentialUseValue(
	value: boolean | null | undefined,
): ConsequentialUseValue {
	if (value === true) {
		return "yes";
	}
	if (value === false) {
		return "no";
	}
	return "unset";
}

function fromConsequentialUseValue(
	value: ConsequentialUseValue,
): boolean | null {
	if (value === "yes") {
		return true;
	}
	if (value === "no") {
		return false;
	}
	return null;
}

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
	const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState(
		organization.metadata?.privacyPolicyUrl ?? "",
	);
	const [termsOfServiceUrl, setTermsOfServiceUrl] = useState(
		organization.metadata?.termsOfServiceUrl ?? "",
	);
	const [legalControllerName, setLegalControllerName] = useState(
		organization.metadata?.legalControllerName ?? "",
	);
	const [controllerJurisdiction, setControllerJurisdiction] = useState(
		organization.metadata?.controllerJurisdiction ?? "",
	);
	const [supportEmail, setSupportEmail] = useState(
		organization.metadata?.supportEmail ?? "",
	);
	const [fallbackIdvUrl, setFallbackIdvUrl] = useState(
		organization.metadata?.fallbackIdvUrl ?? "",
	);
	const [appealUrl, setAppealUrl] = useState(
		organization.metadata?.appealUrl ?? "",
	);
	const [complaintsUrl, setComplaintsUrl] = useState(
		organization.metadata?.complaintsUrl ?? "",
	);
	const [article6Basis, setArticle6Basis] = useState(
		organization.metadata?.article6Basis ?? "",
	);
	const [article9Condition, setArticle9Condition] = useState(
		organization.metadata?.article9Condition ?? "",
	);
	const [
		usesKayleForConsequentialDecisions,
		setUsesKayleForConsequentialDecisions,
	] = useState<ConsequentialUseValue>(
		toConsequentialUseValue(
			organization.metadata?.usesKayleForConsequentialDecisions,
		),
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
		setLegalControllerName(organization.metadata?.legalControllerName ?? "");
		setControllerJurisdiction(
			organization.metadata?.controllerJurisdiction ?? "",
		);
		setSupportEmail(organization.metadata?.supportEmail ?? "");
		setFallbackIdvUrl(organization.metadata?.fallbackIdvUrl ?? "");
		setAppealUrl(organization.metadata?.appealUrl ?? "");
		setComplaintsUrl(organization.metadata?.complaintsUrl ?? "");
		setArticle6Basis(organization.metadata?.article6Basis ?? "");
		setArticle9Condition(organization.metadata?.article9Condition ?? "");
		setUsesKayleForConsequentialDecisions(
			toConsequentialUseValue(
				organization.metadata?.usesKayleForConsequentialDecisions,
			),
		);
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
		organization.metadata?.legalControllerName,
		organization.metadata?.controllerJurisdiction,
		organization.metadata?.supportEmail,
		organization.metadata?.fallbackIdvUrl,
		organization.metadata?.appealUrl,
		organization.metadata?.complaintsUrl,
		organization.metadata?.article6Basis,
		organization.metadata?.article9Condition,
		organization.metadata?.usesKayleForConsequentialDecisions,
	]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const trimmedName = name.trim();
			const trimmedWebsite = website.trim();
			const trimmedDescription = description.trim();
			const trimmedPrivacyPolicyUrl = privacyPolicyUrl.trim();
			const trimmedTermsOfServiceUrl = termsOfServiceUrl.trim();
			const trimmedLegalControllerName = legalControllerName.trim();
			const trimmedControllerJurisdiction = controllerJurisdiction.trim();
			const trimmedSupportEmail = supportEmail.trim();
			const trimmedFallbackIdvUrl = fallbackIdvUrl.trim();
			const trimmedAppealUrl = appealUrl.trim();
			const trimmedComplaintsUrl = complaintsUrl.trim();
			const trimmedArticle6Basis = article6Basis.trim();
			const trimmedArticle9Condition = article9Condition.trim();
			const parsedWebsite = parsePublicWebsiteUrl(trimmedWebsite);
			const parsedPrivacyPolicyUrl = parsePublicPrivacyPolicyUrl(
				trimmedPrivacyPolicyUrl,
			);
			const parsedTermsOfServiceUrl = parsePublicTermsOfServiceUrl(
				trimmedTermsOfServiceUrl,
			);
			const parsedSupportEmail = parsePublicSupportEmail(trimmedSupportEmail);
			const parsedFallbackIdvUrl = parsePublicFallbackIdvUrl(
				trimmedFallbackIdvUrl,
			);
			const parsedAppealUrl = parsePublicAppealUrl(trimmedAppealUrl);
			const parsedComplaintsUrl =
				parsePublicComplaintsUrl(trimmedComplaintsUrl);

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
					legalControllerName: trimmedLegalControllerName || null,
					controllerJurisdiction: trimmedControllerJurisdiction || null,
					supportEmail: parsedSupportEmail,
					fallbackIdvUrl: parsedFallbackIdvUrl?.href ?? null,
					appealUrl: parsedAppealUrl?.href ?? null,
					complaintsUrl: parsedComplaintsUrl?.href ?? null,
					article6Basis: trimmedArticle6Basis || null,
					article9Condition: trimmedArticle9Condition || null,
					usesKayleForConsequentialDecisions: fromConsequentialUseValue(
						usesKayleForConsequentialDecisions,
					),
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
	const trimmedPrivacyPolicyUrl = privacyPolicyUrl.trim();
	const trimmedTermsOfServiceUrl = termsOfServiceUrl.trim();
	const trimmedLegalControllerName = legalControllerName.trim();
	const trimmedControllerJurisdiction = controllerJurisdiction.trim();
	const trimmedSupportEmail = supportEmail.trim();
	const trimmedFallbackIdvUrl = fallbackIdvUrl.trim();
	const trimmedAppealUrl = appealUrl.trim();
	const trimmedComplaintsUrl = complaintsUrl.trim();
	const trimmedArticle6Basis = article6Basis.trim();
	const trimmedArticle9Condition = article9Condition.trim();
	const isDirty =
		trimmedName !== organization.name ||
		trimmedDescription !== (organization.metadata?.description ?? "") ||
		trimmedWebsite !== (organization.metadata?.website ?? "") ||
		trimmedPrivacyPolicyUrl !==
			(organization.metadata?.privacyPolicyUrl ?? "") ||
		trimmedTermsOfServiceUrl !==
			(organization.metadata?.termsOfServiceUrl ?? "") ||
		trimmedLegalControllerName !==
			(organization.metadata?.legalControllerName ?? "") ||
		trimmedControllerJurisdiction !==
			(organization.metadata?.controllerJurisdiction ?? "") ||
		trimmedSupportEmail !== (organization.metadata?.supportEmail ?? "") ||
		trimmedFallbackIdvUrl !== (organization.metadata?.fallbackIdvUrl ?? "") ||
		trimmedAppealUrl !== (organization.metadata?.appealUrl ?? "") ||
		trimmedComplaintsUrl !== (organization.metadata?.complaintsUrl ?? "") ||
		trimmedArticle6Basis !== (organization.metadata?.article6Basis ?? "") ||
		trimmedArticle9Condition !==
			(organization.metadata?.article9Condition ?? "") ||
		usesKayleForConsequentialDecisions !==
			toConsequentialUseValue(
				organization.metadata?.usesKayleForConsequentialDecisions,
			) ||
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
		if (trimmedSupportEmail && !parsePublicSupportEmail(trimmedSupportEmail)) {
			setErrorMessage("Support email must be a valid email address.");
			return;
		}
		if (
			trimmedFallbackIdvUrl &&
			!parsePublicFallbackIdvUrl(trimmedFallbackIdvUrl)
		) {
			setErrorMessage(
				"Fallback IDV link must be a valid http:// or https:// URL without embedded credentials.",
			);
			return;
		}
		if (trimmedAppealUrl && !parsePublicAppealUrl(trimmedAppealUrl)) {
			setErrorMessage(
				"Appeal or human review link must be a valid http:// or https:// URL without embedded credentials.",
			);
			return;
		}
		if (
			trimmedComplaintsUrl &&
			!parsePublicComplaintsUrl(trimmedComplaintsUrl)
		) {
			setErrorMessage(
				"Complaints link must be a valid http:// or https:// URL without embedded credentials.",
			);
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
									? "Click the placeholder to choose an image."
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

			<Card>
				<CardHeader>
					<CardTitle>Legal links</CardTitle>
					<CardDescription>
						Linked from the relying-party dialog so users can review your
						privacy policy and terms of service before sharing their identity.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="public-privacy-policy">Privacy policy URL</Label>
						<Input
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
					</div>
					<div className="space-y-2">
						<Label htmlFor="public-terms-of-service">
							Terms of service URL
						</Label>
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
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Compliance profile</CardTitle>
					<CardDescription>
						Required before production identity checks. Used to show users who
						controls the request and where they can go if Kayle ID is not the
						right route.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="public-controller-name">
								Legal controller name
							</Label>
							<Input
								disabled={!canEdit || isSaving}
								id="public-controller-name"
								name="legalControllerName"
								onChange={(event) => setLegalControllerName(event.target.value)}
								placeholder="Acme Ltd"
								value={legalControllerName}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="public-controller-jurisdiction">
								Controller country or jurisdiction
							</Label>
							<Input
								disabled={!canEdit || isSaving}
								id="public-controller-jurisdiction"
								name="controllerJurisdiction"
								onChange={(event) =>
									setControllerJurisdiction(event.target.value)
								}
								placeholder="United Kingdom"
								value={controllerJurisdiction}
							/>
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="public-support-email">Support email</Label>
							<Input
								autoComplete="email"
								disabled={!canEdit || isSaving}
								id="public-support-email"
								inputMode="email"
								name="supportEmail"
								onChange={(event) => setSupportEmail(event.target.value)}
								placeholder="support@acme.example"
								type="email"
								value={supportEmail}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="public-complaints-url">
								Complaints URL or contact page
							</Label>
							<Input
								autoComplete="url"
								disabled={!canEdit || isSaving}
								id="public-complaints-url"
								inputMode="url"
								name="complaintsUrl"
								onChange={(event) => setComplaintsUrl(event.target.value)}
								placeholder="https://acme.example/complaints"
								type="url"
								value={complaintsUrl}
							/>
						</div>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="public-article-6-basis">
								Declared Article 6 basis
							</Label>
							<Input
								disabled={!canEdit || isSaving}
								id="public-article-6-basis"
								name="article6Basis"
								onChange={(event) => setArticle6Basis(event.target.value)}
								placeholder="Legitimate interests"
								value={article6Basis}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="public-article-9-condition">
								Declared Article 9 condition
							</Label>
							<Input
								disabled={!canEdit || isSaving}
								id="public-article-9-condition"
								name="article9Condition"
								onChange={(event) => setArticle9Condition(event.target.value)}
								placeholder="Explicit consent"
								value={article9Condition}
							/>
						</div>
					</div>
					<div className="space-y-2">
						<Label htmlFor="public-consequential-use">
							Decision purpose declaration
						</Label>
						<Select
							disabled={!canEdit || isSaving}
							onValueChange={(value) =>
								setUsesKayleForConsequentialDecisions(
									value as ConsequentialUseValue,
								)
							}
							value={usesKayleForConsequentialDecisions}
						>
							<SelectTrigger id="public-consequential-use">
								<SelectValue placeholder="Select how Kayle results are used" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="unset">Not declared</SelectItem>
								<SelectItem value="yes">
									Used for access, onboarding, eligibility, or another
									consequential decision
								</SelectItem>
								<SelectItem value="no">
									Not used for a significant automated decision
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-4 md:grid-cols-2">
						<div className="space-y-2">
							<Label htmlFor="public-fallback-idv-url">
								Fallback verification URL
							</Label>
							<Input
								autoComplete="url"
								disabled={!canEdit || isSaving}
								id="public-fallback-idv-url"
								inputMode="url"
								name="fallbackIdvUrl"
								onChange={(event) => setFallbackIdvUrl(event.target.value)}
								placeholder="https://acme.example/manual-idv"
								type="url"
								value={fallbackIdvUrl}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="public-appeal-url">
								Appeal or human review URL
							</Label>
							<Input
								autoComplete="url"
								disabled={!canEdit || isSaving}
								id="public-appeal-url"
								inputMode="url"
								name="appealUrl"
								onChange={(event) => setAppealUrl(event.target.value)}
								placeholder="https://acme.example/review"
								type="url"
								value={appealUrl}
							/>
						</div>
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

function UnverifiedDomainNotice() {
	return (
		<Alert>
			<AlertTitle>
				Verify a domain to surface these details to end-users
			</AlertTitle>
			<AlertDescription>
				<p>
					Until your organization has at least one verified domain, the verify
					flow does not show your logo, legal name, jurisdiction, or
					registration number to end-users — they could be set by anyone, so
					Kayle hides them to protect users from impersonation.
				</p>
				<div className="mt-3">
					<Link
						className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm hover:bg-muted"
						to="/organizations/domains"
					>
						Verify a domain
					</Link>
				</div>
			</AlertDescription>
		</Alert>
	);
}

export function OrganizationPublicDetailsPage() {
	const { user } = useAuth();
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});
	const domainsQuery = useQuery({
		queryFn: listOrganizationDomains,
		queryKey: ORGANIZATION_DOMAINS_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = data?.members.find((member) => member.userId === user?.id)
		?.role as OrganizationRole | undefined;
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
			{showUnverifiedNotice ? (
				<div className="mb-6">
					<UnverifiedDomainNotice />
				</div>
			) : null}
			{isLoading ? <PublicDetailsSkeleton /> : null}
			{data && !isError ? (
				<PublicDetailsForm canEdit={canEdit} organization={data} />
			) : null}
		</OrganizationPageLayout>
	);
}
