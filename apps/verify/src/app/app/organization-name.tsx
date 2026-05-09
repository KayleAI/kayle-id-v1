import OctagonCheck from "@kayle-id/ui/icons/octagon-check";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayleai/ui/dialog";
import { getPlatformNameLabel } from "./platform-name";

export type Organization = {
	name: string | null;
	verified: boolean;
	logo: string | null;
	businessName: string | null;
	businessJurisdiction: string | null;
	businessRegistrationNumber: string | null;
};

const ORG_NAME_TRIGGER_CLASSES =
	"font-bold text-foreground underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const ORG_NAME_TRIGGER_DIM_CLASSES =
	"font-medium underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type OrganizationNameProps = {
	organization: Organization;
	dim?: boolean;
};

/**
 * Renders the relying party's display name as an inline trigger that opens a
 * dialog with the additional org details we expose to end users (legal name,
 * jurisdiction, registration number, verification status). The trigger styling
 * mirrors the dashed-underline cue used elsewhere so the affordance is
 * consistent across the verify flow.
 */
export function OrganizationName({
	organization,
	dim = false,
}: OrganizationNameProps) {
	const platformName = getPlatformNameLabel(organization.name);
	const triggerClassName = dim
		? ORG_NAME_TRIGGER_DIM_CLASSES
		: ORG_NAME_TRIGGER_CLASSES;

	return (
		<Dialog>
			<DialogTrigger
				className={triggerClassName}
				render={<button type="button" />}
			>
				{platformName}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<OrganizationHeading logo={organization.logo} name={platformName} />
					<DialogDescription>
						Information about the organization requesting your verification.
					</DialogDescription>
				</DialogHeader>

				<OrganizationDetailsList organization={organization} />
				<VerificationStatusCallout verified={organization.verified} />

				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}

function OrganizationHeading({
	logo,
	name,
}: {
	logo: string | null;
	name: string;
}) {
	const initial = name.charAt(0).toUpperCase();

	return (
		<div className="flex items-center gap-3">
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
				{logo ? (
					<img
						alt=""
						className="size-full object-cover"
						height={48}
						src={logo}
						width={48}
					/>
				) : (
					<span aria-hidden="true" className="font-medium text-foreground">
						{initial}
					</span>
				)}
			</div>
			<DialogTitle className="text-lg">{name}</DialogTitle>
		</div>
	);
}

function OrganizationDetailsList({
	organization,
}: {
	organization: Organization;
}) {
	const items: { label: string; value: string }[] = [];

	if (organization.businessName) {
		items.push({ label: "Legal name", value: organization.businessName });
	}
	if (organization.businessJurisdiction) {
		items.push({
			label: "Registered in",
			value: organization.businessJurisdiction,
		});
	}
	if (organization.businessRegistrationNumber) {
		items.push({
			label: "Registration number",
			value: organization.businessRegistrationNumber,
		});
	}

	if (items.length === 0) {
		return null;
	}

	return (
		<dl className="grid grid-cols-1 gap-3 text-sm">
			{items.map((item) => (
				<div className="flex flex-col" key={item.label}>
					<dt className="text-muted-foreground text-xs">{item.label}</dt>
					<dd className="font-medium text-foreground">{item.value}</dd>
				</div>
			))}
		</dl>
	);
}

function VerificationStatusCallout({ verified }: { verified: boolean }) {
	if (verified) {
		return (
			<div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
				<div className="flex items-start">
					<div className="mt-0.5 shrink-0">
						<OctagonCheck className="size-5 text-emerald-700" />
					</div>
					<div className="ml-3">
						<h3 className="font-medium text-emerald-800 text-sm">
							Verified by Kayle ID
						</h3>
						<p className="mt-1 text-emerald-700 text-sm">
							The people running this organization have completed Kayle ID's
							owner identity check.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="rounded-lg border border-red-200 bg-red-50 p-3">
			<div className="flex items-start">
				<div className="mt-0.5 shrink-0">
					<OctagonWarning className="size-5 text-red-400" />
				</div>
				<div className="ml-3">
					<h3 className="font-medium text-red-800 text-sm">
						Not verified by Kayle ID
					</h3>
					<p className="mt-1 text-red-700 text-sm">
						Kayle ID has not independently verified the people running this
						organization. Only continue if you trust this request.
					</p>
				</div>
			</div>
		</div>
	);
}
