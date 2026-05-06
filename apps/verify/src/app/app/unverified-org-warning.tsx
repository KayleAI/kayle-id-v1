import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
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

	const cancel = () => {
		// `history.length` is at least 1 for the current entry; >1 means the
		// user navigated here from somewhere else and "back" is meaningful.
		// Otherwise the tab was opened directly (deep link, QR scan) and we
		// fall through to closing it. `window.close()` is a no-op when the
		// browser refuses to close a tab the script didn't open — there is no
		// portable better option from a static page.
		if (window.history.length > 1) {
			window.history.back();
			return;
		}
		window.close();
	};

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
						has not completed Kayle ID's organization verification check. <br />{" "}
						Unless you trust this request, don't continue.
					</p>
				</div>

				<div className="rounded-lg border border-red-200 bg-red-50 p-4">
					<div className="flex items-start">
						<div className="mt-0.5 shrink-0">
							<OctagonWarning className="size-5 text-red-400" />
						</div>
						<div className="ml-3">
							<h3 className="font-medium text-red-800 text-sm">
								What this means
							</h3>
							<ul className="mt-2 list-disc space-y-1 pl-4 text-red-700 text-sm">
								<li>
									Kayle ID has not independently verified the people running
									this organization.
								</li>
								<li>
									If you don't recognise{" "}
									<span className="font-medium underline decoration-dashed underline-offset-2">
										{platformName}
									</span>{" "}
									or didn't expect this verification request, cancel below.
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

				<div className="flex flex-col space-y-4">
					<Button onClick={goToExplain} type="button">
						I trust this organization — continue
					</Button>
					<Button onClick={cancel} type="button" variant="outline">
						Cancel
					</Button>
				</div>
			</div>
		</div>
	);
}
