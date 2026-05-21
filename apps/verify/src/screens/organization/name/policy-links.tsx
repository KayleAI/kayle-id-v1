import type { SVGProps } from "react";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import type { Organization } from "../types";

function ArrowUpRightIcon(props: SVGProps<SVGSVGElement>) {
	const copy = useVerifyHandoffCopy();
	return (
		<svg
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<title>{copy.org.opensInNewTabLabel}</title>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}

export function OrganizationPolicyLinks({
	organization,
}: {
	organization: Organization;
}) {
	const { org } = useVerifyHandoffCopy();
	const links: { label: string; href: string }[] = [];

	if (organization.website) {
		links.push({ label: org.websiteLinkLabel, href: organization.website });
	}
	if (organization.privacyPolicyUrl) {
		links.push({
			label: org.privacyPolicyLinkLabel,
			href: organization.privacyPolicyUrl,
		});
	}
	if (organization.termsOfServiceUrl) {
		links.push({
			label: org.termsOfServiceLinkLabel,
			href: organization.termsOfServiceUrl,
		});
	}

	if (links.length === 0) {
		return null;
	}

	return (
		<ul className="flex flex-col gap-2">
			{links.map((link) => (
				<li key={link.href}>
					<a
						className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-4 py-3 transition-colors hover:border-border/80 hover:bg-muted"
						href={link.href}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span className="font-medium text-foreground text-sm">
							{link.label}
						</span>
						<ArrowUpRightIcon
							aria-hidden="true"
							className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
						/>
					</a>
				</li>
			))}
		</ul>
	);
}
