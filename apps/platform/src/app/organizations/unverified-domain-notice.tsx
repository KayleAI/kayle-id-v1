import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import { Link } from "@tanstack/react-router";

interface UnverifiedDomainNoticeProps {
	hiddenSurfaces: string;
}

export function UnverifiedDomainNotice({
	hiddenSurfaces,
}: UnverifiedDomainNoticeProps) {
	return (
		<Alert>
			<AlertTitle>
				Verify a domain to surface these details to end-users
			</AlertTitle>
			<AlertDescription>
				<p>
					Until your organization has at least one verified domain, the verify
					flow does not show {hiddenSurfaces} to end-users — they could be set
					by anyone, so Kayle hides them to protect users from impersonation.
				</p>
				<div className="mt-3">
					<Link
						className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm hover:bg-muted"
						to="/settings/organizations/domains"
					>
						Verify a domain
					</Link>
				</div>
			</AlertDescription>
		</Alert>
	);
}
