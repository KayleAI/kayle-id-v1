import { client } from "@kayle-id/auth/client";
import { useAuth } from "@kayle-id/auth/client/provider";
import type { Organization } from "@kayle-id/auth/types";
import { Button } from "@kayle-id/ui/components/button";
import { Logo } from "@kayle-id/ui/components/logo";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { resetActiveOrganizationQueries } from "@/app/organizations/active-organization-cache";
import { getErrorMessage } from "@/utils/get-error-message";

export function SelectOrganizations() {
	const { organizations, refresh } = useAuth();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isLoading, setIsLoading] = useState<string | null>(null);
	const [error, setError] = useState("");

	const handleSelectOrganization = async (
		organizationId: string,
		slug: string,
	) => {
		setIsLoading(organizationId);
		setError("");

		try {
			await client.organization.setActive({
				organizationId,
				organizationSlug: slug,
			});
			await refresh();
			await resetActiveOrganizationQueries(queryClient);
			navigate({ to: "/dashboard" });
		} catch (err) {
			setError(
				getErrorMessage(
					err,
					"Failed to select organization. Please try again.",
				),
			);
			setIsLoading(null);
		}
	};

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						Select Organization
					</h1>
					<p className="text-pretty text-lg text-muted-foreground">
						Choose an organization to continue.
					</p>
				</div>

				{error && (
					<div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive text-sm">
						{error}
					</div>
				)}

				<div className="w-full space-y-3">
					{organizations.map((org: Organization) => (
						<button
							className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/50 hover:bg-muted/50"
							disabled={isLoading !== null}
							key={org.id}
							onClick={() => handleSelectOrganization(org.id, org.slug)}
							type="button"
						>
							<div className="flex items-center gap-4">
								<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-border bg-muted">
									{org.logo ? (
										<img
											alt={`${org.name} logo`}
											className="h-full w-full rounded-lg object-cover"
											height={64}
											src={org.logo}
											width={64}
										/>
									) : (
										<div className="flex h-12 w-12 items-center justify-center rounded-full bg-foreground/10">
											<span className="font-medium text-foreground text-lg">
												{org.name.charAt(0).toUpperCase()}
											</span>
										</div>
									)}
								</div>

								<div className="min-w-0 flex-1">
									<h3 className="truncate font-medium text-foreground text-lg">
										{org.name}
									</h3>
									<p className="text-muted-foreground text-sm">{org.slug}</p>
									{org.pendingDeletionAt ? (
										<p className="mt-1 inline-block rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 font-medium text-[11px] text-destructive uppercase tracking-wide">
											Pending deletion
										</p>
									) : null}
								</div>

								{isLoading === org.id && (
									<div className="shrink-0">
										<svg
											aria-label="Loading"
											className="size-5 animate-spin text-muted-foreground"
											fill="none"
											viewBox="0 0 24 24"
										>
											<title>Loading</title>
											<circle
												className="opacity-25"
												cx={12}
												cy={12}
												r={10}
												stroke="currentColor"
												strokeWidth={4}
											/>
											<path
												className="opacity-75"
												d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
												fill="currentColor"
											/>
										</svg>
									</div>
								)}
							</div>
						</button>
					))}
				</div>

				<div className="pt-4">
					<Button
						className="w-full"
						disabled={isLoading !== null}
						nativeButton={false}
						render={
							<Link to="/create-organization">Create new organization</Link>
						}
						variant="outline"
					>
						Create new organization
					</Button>
				</div>
			</div>
		</div>
	);
}
