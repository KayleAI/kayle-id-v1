import { interpolate } from "@kayle-id/translations/i18n";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@kayle-id/ui/components/dialog";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { getPlatformNameLabel } from "../platform-name";
import { OrganizationReportAction } from "../report-dialog";
import type { Organization } from "../types";
import { OrganizationDetailsList, OrganizationIdentityCard } from "./details";
import { selectBadgeApexDomains, VerifiedDomainBadge } from "./domain-badge";
import { OrganizationPolicyLinks } from "./policy-links";
import { VerificationStatusCallout } from "./verification-status";

export type { Organization } from "../types";

const TRIGGER_CLASSES_BOLD =
	"font-bold text-foreground underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const TRIGGER_CLASSES_DIM =
	"font-medium underline decoration-dashed underline-offset-2 cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

type OrganizationNameProps = {
	organization: Organization;
	dim?: boolean;
	isAgeOnly?: boolean;
	sessionId?: null | string;
};

export function OrganizationName({
	organization,
	dim = false,
	isAgeOnly = false,
	sessionId = null,
}: OrganizationNameProps) {
	const platformName = getPlatformNameLabel(organization.name);
	const { org } = useVerifyHandoffCopy();
	const badgeApexes = selectBadgeApexDomains(organization);

	return (
		<Dialog>
			<DialogTrigger
				className={dim ? TRIGGER_CLASSES_DIM : TRIGGER_CLASSES_BOLD}
				render={<button type="button" />}
			>
				{platformName}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="text-lg">
						{interpolate(org.aboutDialogTitle, { name: platformName })}
					</DialogTitle>
					<DialogDescription>{org.aboutDialogDescription}</DialogDescription>
				</DialogHeader>

				<OrganizationIdentityCard
					description={organization.description}
					hasVerifiedDomain={organization.verifiedApexDomains.length > 0}
					logo={organization.logo}
					name={platformName}
				/>
				<div className="flex flex-col gap-2">
					<VerificationStatusCallout
						isAgeOnly={isAgeOnly}
						verified={organization.ownerIdCheckCompleted}
					/>
					<OrganizationDetailsList organization={organization} />
					{badgeApexes ? (
						<VerifiedDomainBadge apexDomains={badgeApexes} />
					) : null}
					<OrganizationPolicyLinks organization={organization} />
				</div>

				<DialogFooter className="sm:justify-between" showCloseButton>
					<OrganizationReportAction
						organization={organization}
						sessionId={sessionId}
						variant="ghost"
					/>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
