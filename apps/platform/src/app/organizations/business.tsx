import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayle-id/ui/components/button";
import { Input } from "@kayle-id/ui/components/input";
import { Label } from "@kayle-id/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kayle-id/ui/components/select";
import { Skeleton } from "@kayle-id/ui/components/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormErrorAlert } from "@/components/form-error-alert";
import { QueryErrorAlert } from "@/components/query-error-alert";
import { getErrorMessage } from "@/utils/get-error-message";
import {
	type FullOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationBusinessType,
	updateOrganizationBusinessDetails,
} from "./api";
import { FormSection } from "./form-section";
import { OrganizationPageLayout } from "./layout";
import {
	useCurrentMemberRole,
	useOrganizationQuery,
} from "./use-organization-query";

function BusinessSkeleton() {
	return (
		<div className="space-y-6">
			<Skeleton className="h-72 w-full" />
		</div>
	);
}

type EffectiveType = OrganizationBusinessType;

// `null` (org hasn't picked) defaults to the registered-entity wording —
// matches what verify-flow does and the typical onboarding case.
function effectiveBusinessType(
	stored: OrganizationBusinessType | null,
): EffectiveType {
	return stored ?? "business";
}

function labelsFor(type: EffectiveType): {
	name: string;
	jurisdiction: string;
	registrationNumber: string;
	helper: { name: string; jurisdiction: string; registrationNumber: string };
} {
	if (type === "sole") {
		return {
			name: "Full name",
			jurisdiction: "Country",
			registrationNumber: "Tax / trader ID",
			helper: {
				name: "The legal name of the person operating the organization.",
				jurisdiction:
					"Where you operate from — typically your country of tax residence.",
				registrationNumber:
					"An optional government-issued identifier such as a tax ID.",
			},
		};
	}
	return {
		name: "Legal name",
		jurisdiction: "Registered in",
		registrationNumber: "Registration number",
		helper: {
			name: "The legal name of the registered entity as it appears on incorporation documents.",
			jurisdiction:
				"Country or sub-national region where the entity is registered.",
			registrationNumber:
				"Company number, EIN, or equivalent identifier. Optional.",
		},
	};
}

export interface BusinessDetailsDraftValues {
	businessType: OrganizationBusinessType;
	businessName: string;
	businessJurisdiction: string;
	businessRegistrationNumber: string;
}

export function BusinessDetailsForm({
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
	onValuesChange?: (values: BusinessDetailsDraftValues) => void;
	organization: FullOrganization;
}) {
	const queryClient = useQueryClient();
	const { refresh } = useAuth();

	const [businessType, setBusinessType] = useState<EffectiveType>(
		effectiveBusinessType(organization.businessType),
	);
	const [businessName, setBusinessName] = useState(
		organization.businessName ?? "",
	);
	const [businessJurisdiction, setBusinessJurisdiction] = useState(
		organization.businessJurisdiction ?? "",
	);
	const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState(
		organization.businessRegistrationNumber ?? "",
	);
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		setBusinessType(effectiveBusinessType(organization.businessType));
		setBusinessName(organization.businessName ?? "");
		setBusinessJurisdiction(organization.businessJurisdiction ?? "");
		setBusinessRegistrationNumber(
			organization.businessRegistrationNumber ?? "",
		);
		setErrorMessage("");
	}, [
		organization.businessType,
		organization.businessName,
		organization.businessJurisdiction,
		organization.businessRegistrationNumber,
	]);

	useEffect(() => {
		onValuesChange?.({
			businessType,
			businessName,
			businessJurisdiction,
			businessRegistrationNumber,
		});
	}, [
		onValuesChange,
		businessType,
		businessName,
		businessJurisdiction,
		businessRegistrationNumber,
	]);

	const saveMutation = useMutation({
		mutationFn: async () => {
			await updateOrganizationBusinessDetails({
				businessType,
				businessName: businessName.trim() ? businessName.trim() : null,
				businessJurisdiction: businessJurisdiction.trim()
					? businessJurisdiction.trim()
					: null,
				businessRegistrationNumber: businessRegistrationNumber.trim()
					? businessRegistrationNumber.trim()
					: null,
			});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ORGANIZATION_QUERY_KEY });
			await refresh();
			// In compact (onboarding-wizard) mode the success toast covers the
			// Back / Skip / Continue footer buttons — suppress it there. The
			// standalone settings page still surfaces it.
			if (!compact) {
				toast.success("Business details updated");
			}
			setErrorMessage("");
			onSaved?.();
		},
		onError: (err) => {
			setErrorMessage(
				getErrorMessage(err, "Failed to update business details"),
			);
		},
	});

	const trimmedName = businessName.trim();
	const trimmedJurisdiction = businessJurisdiction.trim();
	const trimmedRegistration = businessRegistrationNumber.trim();
	const isDirty =
		// Compare to the stored column, not the form's defaulted-display value:
		// when the column is null and the form is showing "Business" by default,
		// clicking Save should still persist "business" instead of being a no-op.
		businessType !== organization.businessType ||
		trimmedName !== (organization.businessName ?? "") ||
		trimmedJurisdiction !== (organization.businessJurisdiction ?? "") ||
		trimmedRegistration !== (organization.businessRegistrationNumber ?? "");

	const isSaving = saveMutation.isPending;
	const labels = labelsFor(businessType);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canEdit || isSaving) {
			return;
		}
		setErrorMessage("");
		// Nothing to persist — fire the onSaved hook anyway so external callers
		// (e.g. the onboarding wizard) can advance past an already-complete step
		// when the user clicks Continue without touching any field.
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
					Business details
				</h1>
				<p className="text-muted-foreground text-sm">
					Your registered legal entity, or the individual operating it. Your
					users will be able to see these and they're important for compliance.
				</p>
			</div>

			<FormErrorAlert message={errorMessage} />

			<FormSection compact={compact}>
				<div className="space-y-2">
					<Label htmlFor="business-type">Type</Label>
					<Select
						disabled={!canEdit || isSaving}
						name="businessType"
						onValueChange={(value) => {
							if (value === "sole" || value === "business") {
								setBusinessType(value);
							}
						}}
						value={businessType}
					>
						<SelectTrigger className="w-full" id="business-type">
							<SelectValue>
								{(value) =>
									value === "sole"
										? "Individual / sole trader"
										: "Business (registered legal entity)"
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="business">
								Business (registered legal entity)
							</SelectItem>
							<SelectItem value="sole">Individual / sole trader</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs">
						{businessType === "sole"
							? "Pick this if you operate under your own legal name."
							: "Pick this if your organization is a registered business."}
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="business-name">{labels.name}</Label>
					<Input
						autoComplete={businessType === "sole" ? "name" : "organization"}
						disabled={!canEdit || isSaving}
						id="business-name"
						maxLength={200}
						name="businessName"
						onChange={(event) => setBusinessName(event.target.value)}
						placeholder={
							businessType === "sole" ? "Jane Doe" : "Acme Corporation Ltd"
						}
						value={businessName}
					/>
					<p className="text-muted-foreground text-xs">{labels.helper.name}</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="business-jurisdiction">{labels.jurisdiction}</Label>
					<Input
						autoComplete="country-name"
						disabled={!canEdit || isSaving}
						id="business-jurisdiction"
						maxLength={120}
						name="businessJurisdiction"
						onChange={(event) => setBusinessJurisdiction(event.target.value)}
						placeholder="United Kingdom"
						value={businessJurisdiction}
					/>
					<p className="text-muted-foreground text-xs">
						{labels.helper.jurisdiction}
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="business-registration-number">
						{labels.registrationNumber}
					</Label>
					<Input
						autoComplete="off"
						disabled={!canEdit || isSaving}
						id="business-registration-number"
						maxLength={100}
						name="businessRegistrationNumber"
						onChange={(event) =>
							setBusinessRegistrationNumber(event.target.value)
						}
						placeholder={businessType === "sole" ? "GB123456789" : "12345678"}
						value={businessRegistrationNumber}
					/>
					<p className="text-muted-foreground text-xs">
						{labels.helper.registrationNumber}
					</p>
				</div>

				{compact ? null : (
					<div className="flex justify-end">
						<Button disabled={!canEdit || !isDirty || isSaving} type="submit">
							{isSaving ? "Saving..." : "Save changes"}
						</Button>
					</div>
				)}
			</FormSection>
		</form>
	);
}

export function OrganizationBusinessPage() {
	const { data, isLoading, isError, error } = useOrganizationQuery();
	const canEdit = useCurrentMemberRole() === "owner";

	return (
		<OrganizationPageLayout
			description="The legal entity (or individual) behind the organization."
			title="Business Details"
		>
			<QueryErrorAlert
				error={isError ? error : null}
				fallback="Something went wrong while loading business details."
				title="Failed to load business details"
			/>
			{isLoading ? <BusinessSkeleton /> : null}
			{data && !isError ? (
				<BusinessDetailsForm canEdit={canEdit} organization={data} />
			) : null}
		</OrganizationPageLayout>
	);
}
