import { Button } from "@kayleai/ui/button";
import { Logo } from "@kayleai/ui/logo";
import { useVerificationStore } from "../../stores/session";
import { getPlatformNameLabel } from "./platform-name";

/**
 * Warning interstitial shown before `explain` when the requesting organization
 * has not completed Kayle ID's owner identity check. Users are told that the
 * verifier hasn't been independently verified and given a clear cancel path.
 *
 * Suppressed for age-gate-only sessions (where the org isn't requesting any
 * identity-bearing claim) and for verified orgs.
 */
export function UnverifiedOrgWarning({
	organizationName,
}: {
	organizationName?: string | null;
}) {
	const goToExplain = useVerificationStore((state) => state.goToExplain);
	const platformName = getPlatformNameLabel(organizationName);

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						You are about to verify with an unverified organization
					</h1>
					<p className="text-lg text-muted-foreground">
						<span className="font-bold text-foreground underline decoration-dashed underline-offset-2">
							{platformName}
						</span>{" "}
						has not completed Kayle ID's organization verification check. Only
						proceed if you trust this organization with your identity.
					</p>
				</div>

				<div>
					<h3 className="mb-2 font-medium text-base text-foreground">
						What this means:
					</h3>
					<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
						<li>
							Kayle ID has not independently verified the people running this
							organization.
						</li>
						<li>
							If you don't recognise{" "}
							<span className="font-medium text-foreground">
								{platformName}
							</span>{" "}
							or didn't expect this verification request, cancel below.
						</li>
						<li>
							Verified organizations display a checkmark on this screen instead
							of this warning.
						</li>
					</ul>
				</div>

				<div className="flex flex-col space-y-4">
					<Button onClick={goToExplain} type="button">
						I trust this organization — continue
					</Button>
					<Button
						onClick={() => window.history.back()}
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
