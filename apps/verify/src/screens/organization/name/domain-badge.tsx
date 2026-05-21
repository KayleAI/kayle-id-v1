import { StatusCallout } from "@/components/status-callout";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import type { Organization } from "../types";

function extractHostname(rawUrl: string): string | null {
	try {
		return new URL(rawUrl).hostname.toLowerCase();
	} catch {
		return null;
	}
}

// Returns the unique sorted set of verified apex domains that anchor every
// present policy/website URL — or null if any URL is on a non-verified host,
// or there are no URLs to anchor against.
export function selectBadgeApexDomains(
	organization: Organization,
): string[] | null {
	if (organization.verifiedApexDomains.length === 0) {
		return null;
	}

	const candidateUrls = [
		organization.website,
		organization.privacyPolicyUrl,
		organization.termsOfServiceUrl,
	].filter((value): value is string => Boolean(value));

	if (candidateUrls.length === 0) {
		return null;
	}

	const matched = new Set<string>();
	for (const rawUrl of candidateUrls) {
		const host = extractHostname(rawUrl);
		if (!host) {
			return null;
		}
		const apex = organization.verifiedApexDomains.find(
			(candidate) => host === candidate || host.endsWith(`.${candidate}`),
		);
		if (!apex) {
			return null;
		}
		matched.add(apex);
	}

	return Array.from(matched).sort();
}

export function VerifiedDomainBadge({
	apexDomains,
}: {
	apexDomains: string[];
}) {
	const { org } = useVerifyHandoffCopy();
	const isPlural = apexDomains.length > 1;
	const title = isPlural
		? org.verifiedDomainTitlePlural
		: org.verifiedDomainTitleSingular;
	const description = isPlural
		? org.verifiedDomainDescriptionPlural
		: org.verifiedDomainDescriptionSingular;

	return (
		<StatusCallout tone="emerald" title={title} description={description}>
			{isPlural ? (
				<ul className="mt-1 break-all font-mono text-emerald-700 text-sm dark:text-emerald-300">
					{apexDomains.map((domain) => (
						<li className="list-inside list-disc" key={domain}>
							{domain}
						</li>
					))}
				</ul>
			) : (
				<p className="mt-1 break-all font-mono text-emerald-700 text-sm dark:text-emerald-300">
					{apexDomains[0]}
				</p>
			)}
		</StatusCallout>
	);
}
