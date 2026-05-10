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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	type FullOrganization,
	fetchFullOrganization,
	ORGANIZATION_QUERY_KEY,
	type OrganizationBusinessType,
	type OrganizationRole,
	updateOrganizationBusinessDetails,
} from "./api";
import { OrganizationPageLayout } from "./layout";

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
					"A government-issued identifier such as a tax ID, VAT number, or trader registration. Optional.",
			},
		};
	}
	return {
		name: "Legal name",
		jurisdiction: "Registered in",
		registrationNumber: "Registration number",
		helper: {
			name: "The legal name of the registered entity (e.g. as it appears on incorporation documents).",
			jurisdiction:
				"Country or sub-national region where the entity is registered.",
			registrationNumber:
				"Company number, EIN, or equivalent identifier. Optional.",
		},
	};
}

function BusinessDetailsForm({
	canEdit,
	organization,
}: {
	canEdit: boolean;
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
			toast.success("Business details updated");
			setErrorMessage("");
		},
		onError: (err) => {
			setErrorMessage(
				err instanceof Error
					? err.message
					: "Failed to update business details",
			);
		},
	});

	const trimmedName = businessName.trim();
	const trimmedJurisdiction = businessJurisdiction.trim();
	const trimmedRegistration = businessRegistrationNumber.trim();
	const isDirty =
		businessType !== effectiveBusinessType(organization.businessType) ||
		trimmedName !== (organization.businessName ?? "") ||
		trimmedJurisdiction !== (organization.businessJurisdiction ?? "") ||
		trimmedRegistration !== (organization.businessRegistrationNumber ?? "");

	const isSaving = saveMutation.isPending;
	const labels = labelsFor(businessType);

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!canEdit || !isDirty || isSaving) {
			return;
		}
		setErrorMessage("");
		saveMutation.mutate();
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Business details</CardTitle>
				<CardDescription>
					Your registered legal entity, or the individual operating it. Your
					users will be able to see these.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form className="space-y-5" onSubmit={handleSubmit}>
					{errorMessage ? (
						<Alert variant="destructive">
							<AlertTitle>Error</AlertTitle>
							<AlertDescription>{errorMessage}</AlertDescription>
						</Alert>
					) : null}
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
								? "Pick this if you operate under your own legal name without a separate registered entity."
								: "Pick this if your organization is a registered company, LLC, partnership, or similar."}
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
						<p className="text-muted-foreground text-xs">
							{labels.helper.name}
						</p>
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

					<div className="flex justify-end">
						<Button disabled={!canEdit || !isDirty || isSaving} type="submit">
							{isSaving ? "Saving..." : "Save changes"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

export function OrganizationBusinessPage() {
	const { user } = useAuth();
	const { data, isLoading, isError, error } = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = data?.members.find((member) => member.userId === user?.id)
		?.role as OrganizationRole | undefined;
	const canEdit = currentRole === "owner";

	return (
		<OrganizationPageLayout
			description="The legal entity (or individual) behind the organization."
			title="Business Details"
		>
			{isError ? (
				<Alert variant="destructive">
					<AlertTitle>Failed to load business details</AlertTitle>
					<AlertDescription>
						{error instanceof Error
							? error.message
							: "Something went wrong while loading business details."}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading ? <BusinessSkeleton /> : null}
			{data && !isError ? (
				<BusinessDetailsForm canEdit={canEdit} organization={data} />
			) : null}
		</OrganizationPageLayout>
	);
}
