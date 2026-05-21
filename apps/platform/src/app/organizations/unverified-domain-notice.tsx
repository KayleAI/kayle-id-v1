import { Button } from "@kayle-id/ui/components/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import { Link } from "@tanstack/react-router";

interface UnverifiedDomainNoticeProps {
	hiddenSurfaces: string;
}

export function UnverifiedDomainNotice({
	hiddenSurfaces,
}: UnverifiedDomainNoticeProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					Verify a domain to surface these details to end-users
				</CardTitle>
				<CardDescription>
					Until your organization has at least one verified domain, we won't
					show {hiddenSurfaces} to users.
				</CardDescription>
			</CardHeader>
			<CardFooter>
				<Button
					variant="outline"
					render={<Link to="/settings/organizations/domains" />}
				>
					Verify a domain
				</Button>
			</CardFooter>
		</Card>
	);
}
