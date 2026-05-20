import { Button } from "@kayle-id/ui/components/button";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import { PageShell } from "@/components/page-shell";
import { useVerificationStore } from "@/stores/session";
import { OrganizationName } from "./organization/name";
import type { Organization } from "./organization/types";

export function UnverifiedOrgWarning({
	organization,
}: {
	organization: Organization;
}) {
	const goToExplain = useVerificationStore((state) => state.goToExplain);

	const cancel = () => {
		if (window.history.length > 1) {
			window.history.back();
			return;
		}
		window.close();
	};

	return (
		<PageShell
			heading="You are about to verify with an unverified organization"
			description={
				<>
					Kayle ID has not confirmed control of a domain for{" "}
					<OrganizationName organization={organization} />. <br /> Unless you
					trust this request, don't continue.
				</>
			}
			actions={
				<>
					<Button onClick={goToExplain} type="button">
						I trust this organization — continue
					</Button>
					<Button onClick={cancel} type="button" variant="outline">
						Cancel
					</Button>
				</>
			}
		>
			<div className="my-8 flex-1">
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
					<div className="flex items-start">
						<div className="mt-0.5 shrink-0">
							<OctagonWarning className="size-5 text-red-400" />
						</div>
						<div className="ml-3">
							<h3 className="font-medium text-red-800 text-sm dark:text-red-200">
								What this means
							</h3>
							<ul className="mt-2 list-disc space-y-1 pl-4 text-red-700 text-sm dark:text-red-300">
								<li>
									Kayle ID has not independently verified the people running
									this organization.
								</li>
								<li>
									If you don't recognise{" "}
									<OrganizationName dim organization={organization} /> or didn't
									expect this verification request, cancel below.
								</li>
								<li>
									You'll only see this warning if you're about to perform an ID
									check for an organization that has not completed Kayle ID's
									organization verification check.
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</PageShell>
	);
}
