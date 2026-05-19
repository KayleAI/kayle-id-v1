import { useAuth } from "@kayle-id/auth/client/provider";
import { RP_INTEGRATION_TERMS_CANONICAL_TEXT } from "@kayle-id/auth/rp-integration-terms";
import type { OrganizationRole } from "@kayle-id/auth/types";
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
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kayleai/ui/dialog";
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
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	acceptRpIntegrationTerms,
	type FullOrganization,
	fetchFullOrganization,
	fetchRpIntegrationTermsStatus,
	listOrganizationDomains,
	ORGANIZATION_DOMAINS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
	ORGANIZATION_RP_TERMS_QUERY_KEY,
	updateOrganization,
} from "./api";
import { FormSection } from "./form-section";
import { OrganizationPageLayout } from "./layout";
import {
	parsePublicAppealUrl,
	parsePublicComplaintsUrl,
	parsePublicFallbackIdvUrl,
	parsePublicSupportEmail,
} from "./website-url";

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

function RequiredMark() {
	return (
		<>
			<span aria-hidden="true" className="ml-0.5 text-destructive">
				*
			</span>
			<span className="sr-only"> (required)</span>
		</>
	);
}

function ComplianceSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-96 w-full" />
			<Skeleton className="h-44 w-full" />
		</div>
	);
}

export interface ComplianceDraftValues {
	legalControllerName: string;
	controllerJurisdiction: string;
	supportEmail: string;
	fallbackIdvUrl: string;
	appealUrl: string;
	complaintsUrl: string;
	article6Basis: string;
	article9Condition: string;
	usesKayleForConsequentialDecisions: boolean | null;
}

export function ComplianceForm({
	canAcceptRpTerms,
	canEdit,
	compact,
	onSaved,
	onValuesChange,
	organization,
}: {
	canAcceptRpTerms: boolean;
	canEdit: boolean;
	compact?: boolean;
	onSaved?: () => void;
	/**
	 * Called whenever any of the form's editable values change. Used by the
	 * onboarding shell to gate Continue on draft completeness.
	 */
	onValuesChange?: (values: ComplianceDraftValues) => void;
	organization: FullOrganization;
}) {
	const queryClient = useQueryClient();
	const { refresh } = useAuth();

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
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
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
		setErrorMessage("");
	}, [
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

	useEffect(() => {
		onValuesChange?.({
			legalControllerName,
			controllerJurisdiction,
			supportEmail,
			fallbackIdvUrl,
			appealUrl,
			complaintsUrl,
			article6Basis,
			article9Condition,
			usesKayleForConsequentialDecisions: fromConsequentialUseValue(
				usesKayleForConsequentialDecisions,
			),
		});
	}, [
		onValuesChange,
		legalControllerName,
		controllerJurisdiction,
		supportEmail,
		fallbackIdvUrl,
		appealUrl,
		complaintsUrl,
		article6Basis,
		article9Condition,
		usesKayleForConsequentialDecisions,
	]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const trimmedLegalControllerName = legalControllerName.trim();
			const trimmedControllerJurisdiction = controllerJurisdiction.trim();
			const trimmedSupportEmail = supportEmail.trim();
			const trimmedFallbackIdvUrl = fallbackIdvUrl.trim();
			const trimmedAppealUrl = appealUrl.trim();
			const trimmedComplaintsUrl = complaintsUrl.trim();
			const trimmedArticle6Basis = article6Basis.trim();
			const trimmedArticle9Condition = article9Condition.trim();
			const parsedSupportEmail = parsePublicSupportEmail(trimmedSupportEmail);
			const parsedFallbackIdvUrl = parsePublicFallbackIdvUrl(
				trimmedFallbackIdvUrl,
			);
			const parsedAppealUrl = parsePublicAppealUrl(trimmedAppealUrl);
			const parsedComplaintsUrl =
				parsePublicComplaintsUrl(trimmedComplaintsUrl);

			await updateOrganization(organization.id, {
				metadata: {
					// Preserve public-details metadata so this update doesn't wipe it.
					description: organization.metadata?.description ?? null,
					website: organization.metadata?.website ?? null,
					privacyPolicyUrl: organization.metadata?.privacyPolicyUrl ?? null,
					termsOfServiceUrl: organization.metadata?.termsOfServiceUrl ?? null,
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
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			// In compact (onboarding-wizard) mode the success toast covers the
			// Back / Skip / Continue footer buttons — suppress it there.
			if (!compact) {
				toast.success("Compliance details updated");
			}
			setErrorMessage("");
			onSaved?.();
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error ? err.message : "Failed to update compliance",
			);
		},
	});

	const trimmedLegalControllerName = legalControllerName.trim();
	const trimmedControllerJurisdiction = controllerJurisdiction.trim();
	const trimmedSupportEmail = supportEmail.trim();
	const trimmedFallbackIdvUrl = fallbackIdvUrl.trim();
	const trimmedAppealUrl = appealUrl.trim();
	const trimmedComplaintsUrl = complaintsUrl.trim();
	const trimmedArticle6Basis = article6Basis.trim();
	const trimmedArticle9Condition = article9Condition.trim();
	const isDirty =
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
			);

	const isSaving = saveMutation.isPending;

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canEdit || isSaving) {
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
		if (!isDirty) {
			onSaved?.();
			return;
		}
		saveMutation.mutate();
	};

	const consequentialRequired = usesKayleForConsequentialDecisions === "yes";

	return (
		<form
			className="space-y-6"
			id={compact ? "onboarding-form" : undefined}
			onSubmit={handleSubmit}
		>
			<div className="space-y-2">
				<h1 className="font-semibold text-2xl text-foreground tracking-tight">
					Compliance profile
				</h1>
				<p className="text-muted-foreground text-sm">
					Shows users who controls the requests for identity checks.
				</p>
			</div>

			{errorMessage ? (
				<Alert variant="destructive">
					<AlertTitle>Error</AlertTitle>
					<AlertDescription>{errorMessage}</AlertDescription>
				</Alert>
			) : null}

			<FormSection compact={compact}>
				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="compliance-controller-name">
							Legal controller name
							<RequiredMark />
						</Label>
						<Input
							aria-required="true"
							disabled={!canEdit || isSaving}
							id="compliance-controller-name"
							name="legalControllerName"
							onChange={(event) => setLegalControllerName(event.target.value)}
							placeholder="Acme Ltd"
							value={legalControllerName}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="compliance-controller-jurisdiction">
							Controller jurisdiction
							<RequiredMark />
						</Label>
						<Input
							aria-required="true"
							disabled={!canEdit || isSaving}
							id="compliance-controller-jurisdiction"
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
						<Label htmlFor="compliance-support-email">
							Support email
							<RequiredMark />
						</Label>
						<Input
							aria-required="true"
							autoComplete="email"
							disabled={!canEdit || isSaving}
							id="compliance-support-email"
							inputMode="email"
							name="supportEmail"
							onChange={(event) => setSupportEmail(event.target.value)}
							placeholder="support@acme.example"
							type="email"
							value={supportEmail}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="compliance-complaints-url">
							Complaints URL or contact page
						</Label>
						<Input
							autoComplete="url"
							disabled={!canEdit || isSaving}
							id="compliance-complaints-url"
							inputMode="url"
							name="complaintsUrl"
							onChange={(event) => setComplaintsUrl(event.target.value)}
							placeholder="https://acme.example/complaints"
							type="url"
							value={complaintsUrl}
						/>
					</div>
				</div>
			</FormSection>

			<FormSection compact={compact}>
				<div className="space-y-2">
					<Label htmlFor="compliance-article-6-basis">
						Declared Article 6 basis
						<RequiredMark />
					</Label>
					<Textarea
						aria-required="true"
						disabled={!canEdit || isSaving}
						id="compliance-article-6-basis"
						name="article6Basis"
						onChange={(event) => setArticle6Basis(event.target.value)}
						placeholder="Legitimate interests"
						rows={3}
						value={article6Basis}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="compliance-article-9-condition">
						Declared Article 9 condition
						<RequiredMark />
					</Label>
					<Textarea
						aria-required="true"
						disabled={!canEdit || isSaving}
						id="compliance-article-9-condition"
						name="article9Condition"
						onChange={(event) => setArticle9Condition(event.target.value)}
						placeholder="Explicit consent"
						rows={3}
						value={article9Condition}
					/>
				</div>
			</FormSection>

			<FormSection compact={compact}>
				<div className="space-y-2">
					<Label htmlFor="compliance-consequential-use">
						Decision purpose declaration
						<RequiredMark />
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
						<SelectTrigger className="w-full" id="compliance-consequential-use">
							<SelectValue placeholder="Select how Kayle results are used">
								{(value) => {
									if (value === "yes") {
										return "Used for access, onboarding, eligibility, or another consequential decision";
									}
									if (value === "no") {
										return "Not used for a significant automated decision";
									}
									return "Not declared";
								}}
							</SelectValue>
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
						<Label htmlFor="compliance-fallback-idv-url">
							Fallback verification URL
							{consequentialRequired ? <RequiredMark /> : null}
						</Label>
						<Input
							aria-required={consequentialRequired ? "true" : undefined}
							autoComplete="url"
							disabled={!canEdit || isSaving}
							id="compliance-fallback-idv-url"
							inputMode="url"
							name="fallbackIdvUrl"
							onChange={(event) => setFallbackIdvUrl(event.target.value)}
							placeholder="https://acme.example/manual-idv"
							type="url"
							value={fallbackIdvUrl}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="compliance-appeal-url">
							Appeal or human review URL
							{consequentialRequired ? <RequiredMark /> : null}
						</Label>
						<Input
							aria-required={consequentialRequired ? "true" : undefined}
							autoComplete="url"
							disabled={!canEdit || isSaving}
							id="compliance-appeal-url"
							inputMode="url"
							name="appealUrl"
							onChange={(event) => setAppealUrl(event.target.value)}
							placeholder="https://acme.example/review"
							type="url"
							value={appealUrl}
						/>
					</div>
				</div>
				{consequentialRequired ? (
					<p className="text-muted-foreground text-xs">
						Required because Kayle ID is being used for consequential decisions.
					</p>
				) : null}
			</FormSection>

			<RpIntegrationTermsCard canAccept={canAcceptRpTerms} compact={compact} />

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

function RpIntegrationTermsCard({
	canAccept,
	compact,
}: {
	canAccept: boolean;
	compact?: boolean;
}) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const { data, isError, isLoading } = useQuery({
		queryFn: fetchRpIntegrationTermsStatus,
		queryKey: ORGANIZATION_RP_TERMS_QUERY_KEY,
		staleTime: 30_000,
	});
	const acceptMutation = useMutation({
		mutationFn: acceptRpIntegrationTerms,
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ORGANIZATION_RP_TERMS_QUERY_KEY,
			});
			// Same logic as the form-save toasts — suppress in onboarding so
			// the floating-card footer stays clear.
			if (!compact) {
				toast.success("Kayle ID Integration Terms accepted");
			}
			setOpen(false);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: "Failed to accept Kayle ID Integration Terms",
			);
		},
	});

	const acceptedAt = data?.acceptance?.accepted_at
		? new Date(data.acceptance.accepted_at).toLocaleString()
		: null;
	const isAccepted = data?.current_accepted === true;
	const termsParagraphs = RP_INTEGRATION_TERMS_CANONICAL_TEXT.split("\n");

	const titleText = isAccepted
		? "Current terms accepted"
		: "Current terms not accepted";
	const subtitleText = `Version ${data?.current.terms_version ?? "loading"} · ${
		data?.current.jurisdiction ?? "loading"
	}${acceptedAt ? ` · Accepted ${acceptedAt}` : ""}`;
	const description =
		"These terms record the current controller split, fallback IDV, and review safeguards for relying parties.";

	return (
		<>
			{compact ? (
				<section className="space-y-3">
					<div className="space-y-1">
						<h3 className="font-medium text-foreground text-sm">{titleText}</h3>
						<p className="text-muted-foreground text-sm">{description}</p>
						<p className="text-muted-foreground text-xs">{subtitleText}</p>
					</div>
					{isError ? (
						<Alert variant="destructive">
							<AlertTitle>Failed to load terms status</AlertTitle>
							<AlertDescription>
								Refresh the page before accepting the current Kayle ID
								Integration Terms.
							</AlertDescription>
						</Alert>
					) : null}
					<Button
						disabled={isLoading || isError}
						onClick={() => setOpen(true)}
						type="button"
						variant="outline"
					>
						View terms
					</Button>
				</section>
			) : (
				<Card>
					<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-1.5">
							<CardTitle>{titleText}</CardTitle>
							<CardDescription>{description}</CardDescription>
							<p className="text-muted-foreground text-xs">{subtitleText}</p>
						</div>
						<Button
							disabled={isLoading || isError}
							onClick={() => setOpen(true)}
							type="button"
						>
							View terms
						</Button>
					</CardHeader>
					{isError ? (
						<CardContent>
							<Alert variant="destructive">
								<AlertTitle>Failed to load terms status</AlertTitle>
								<AlertDescription>
									Refresh the page before accepting the current Kayle ID
									Integration Terms.
								</AlertDescription>
							</Alert>
						</CardContent>
					) : null}
				</Card>
			)}

			<Dialog onOpenChange={setOpen} open={open}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Kayle ID Integration Terms</DialogTitle>
						<DialogDescription>
							Version {data?.current.terms_version ?? "current"} ·{" "}
							{data?.current.jurisdiction ?? ""}
						</DialogDescription>
					</DialogHeader>
					<div className="max-h-[60vh] space-y-3 overflow-y-auto rounded-2xl border border-border bg-muted/30 p-4 text-foreground text-sm leading-relaxed">
						{termsParagraphs.map((paragraph) => (
							<p key={paragraph}>{paragraph}</p>
						))}
					</div>
					{isAccepted ? (
						<p className="text-muted-foreground text-xs">
							These terms were accepted{acceptedAt ? ` on ${acceptedAt}` : ""}.
						</p>
					) : null}
					{!(canAccept || isAccepted) ? (
						<p className="text-muted-foreground text-xs">
							Only owners can accept Kayle ID Integration Terms.
						</p>
					) : null}
					<DialogFooter>
						<DialogClose
							disabled={acceptMutation.isPending}
							render={<Button type="button" variant="outline" />}
						>
							Cancel
						</DialogClose>
						<Button
							disabled={
								isAccepted || !canAccept || acceptMutation.isPending || isError
							}
							onClick={() => acceptMutation.mutate()}
							type="button"
						>
							{acceptMutation.isPending ? "Accepting..." : "Accept Terms"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
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
					flow does not show your controller name, jurisdiction, or other
					compliance details to end-users — they could be set by anyone, so
					Kayle hides them to protect users from impersonation.
				</p>
				<div className="mt-3">
					<Link
						className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm hover:bg-muted"
						to="/settings/organizations/domains"
					>
						Verify a domain
					</Link>
				</div>
			</AlertDescription>
		</Alert>
	);
}

export function OrganizationCompliancePage() {
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
			description="Controller, lawful basis, and consumer-protection settings required before production identity checks."
			title="Compliance"
		>
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load compliance settings</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading compliance settings."}
					</AlertDescription>
				</Alert>
			) : null}
			{showUnverifiedNotice ? (
				<div className="mb-6">
					<UnverifiedDomainNotice />
				</div>
			) : null}
			{isLoading ? <ComplianceSkeleton /> : null}
			{data && !isError ? (
				<ComplianceForm
					canAcceptRpTerms={currentRole === "owner"}
					canEdit={canEdit}
					organization={data}
				/>
			) : null}
		</OrganizationPageLayout>
	);
}
