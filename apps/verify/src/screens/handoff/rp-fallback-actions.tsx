import { interpolate } from "@kayle-id/translations/i18n";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { getPlatformNameLabel } from "../organization/platform-name";
import type { Organization } from "../organization/types";

export function hasRpFallbackActions(organization: Organization): boolean {
	const { rpFallback } = organization;
	return Boolean(
		rpFallback.fallbackIdvUrl ||
			rpFallback.appealUrl ||
			rpFallback.supportEmail ||
			rpFallback.complaintsUrl,
	);
}

export function RpFallbackActions({
	organization,
}: {
	organization: Organization;
}) {
	const { rpFallback: copy } = useVerifyHandoffCopy();
	const organizationLabel = getPlatformNameLabel(organization.name);
	const { rpFallback } = organization;
	const links: { href: string; label: string }[] = [];

	if (rpFallback.fallbackIdvUrl) {
		links.push({
			href: rpFallback.fallbackIdvUrl,
			label: copy.fallbackIdvLabel,
		});
	}
	if (rpFallback.appealUrl) {
		links.push({ href: rpFallback.appealUrl, label: copy.appealLabel });
	}
	if (rpFallback.supportEmail) {
		links.push({
			href: `mailto:${rpFallback.supportEmail}`,
			label: interpolate(copy.contactLabel, {
				organization: organizationLabel,
			}),
		});
	}
	if (rpFallback.complaintsUrl) {
		links.push({
			href: rpFallback.complaintsUrl,
			label: copy.complaintsLabel,
		});
	}

	if (links.length === 0) {
		return null;
	}

	return (
		<div className="rounded-xl border border-border bg-muted/40 p-4">
			<p className="font-medium text-foreground text-sm">{copy.title}</p>
			<p className="mt-1 text-muted-foreground text-sm">{copy.description}</p>
			<div className="mt-3 flex flex-col gap-2">
				{links.map((link) => {
					const isMailto = link.href.startsWith("mailto:");
					return (
						<a
							className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm hover:bg-muted"
							href={link.href}
							key={`${link.label}:${link.href}`}
							rel={isMailto ? undefined : "noopener noreferrer"}
							target={isMailto ? undefined : "_blank"}
						>
							{link.label}
						</a>
					);
				})}
			</div>
		</div>
	);
}
