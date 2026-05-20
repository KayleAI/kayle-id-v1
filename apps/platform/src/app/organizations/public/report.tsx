import { ORGANIZATION_REPORT_REASONS } from "@kayle-id/config/organization-reports";
import { Button } from "@kayle-id/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import {
	PublicOrganizationAvatar,
	PublicPageShell,
} from "@/components/public-organizations/shared";
import {
	type OrganizationReportReason,
	type ReportableOrganization,
	submitPublicOrganizationReport,
} from "@/lib/api/report";
import { ORGANIZATION_REPORT_REASON_LABELS } from "@/lib/organization-report-labels";

const DETAILS_MAX_LENGTH = 2000;

const REASON_DESCRIPTIONS: Record<OrganizationReportReason, string> = {
	deceptive_use:
		"The organization appears to be misrepresenting why it needs identity verification.",
	discrimination_or_eligibility_concern:
		"The check appears to affect access or eligibility in an unfair way.",
	impersonation:
		"The organization appears to be pretending to be another business or service.",
	missing_fallback_or_appeal:
		"The organization does not provide a meaningful fallback, appeal, or human review route.",
	other: "The concern does not fit the other categories.",
	privacy_concern:
		"The organization appears to be requesting, retaining, or sharing data in a concerning way.",
};

function ReportPageHeader({
	description,
	title,
}: {
	description: string;
	title: string;
}) {
	return (
		<div className="max-w-3xl">
			<h1 className="text-balance font-light text-5xl tracking-tighter">
				{title}
			</h1>
			<p className="mt-4 max-w-[68ch] text-base text-muted-foreground text-pretty sm:text-sm">
				{description}
			</p>
		</div>
	);
}

function ReasonOption({
	disabled,
	groupName,
	onSelect,
	reason,
	selectedReason,
}: {
	disabled: boolean;
	groupName: string;
	onSelect: (reason: OrganizationReportReason) => void;
	reason: OrganizationReportReason;
	selectedReason: "" | OrganizationReportReason;
}) {
	return (
		<li>
			<label className="group flex cursor-pointer items-start gap-3 p-4 transition-colors has-checked:bg-muted/60 hover:bg-muted/40 has-disabled:cursor-not-allowed has-disabled:opacity-60">
				<div className="flex h-lh items-center text-base sm:text-sm">
					<span className="group inline-grid size-5 grid-cols-1 sm:size-4">
						<input
							checked={selectedReason === reason}
							className="col-start-1 row-start-1 appearance-none rounded-full border border-border bg-background checked:border-foreground checked:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:border-border disabled:bg-muted forced-colors:appearance-auto"
							disabled={disabled}
							name={groupName}
							onChange={() => onSelect(reason)}
							required
							type="radio"
							value={reason}
						/>
						<span className="pointer-events-none col-start-1 row-start-1 size-[round(down,40%,1px)] self-center justify-self-center rounded-full bg-background group-not-has-checked:opacity-0 group-has-disabled:bg-muted-foreground" />
					</span>
				</div>
				<div className="min-w-0">
					<p className="font-medium text-base sm:text-sm">
						{ORGANIZATION_REPORT_REASON_LABELS[reason]}
					</p>
					<p className="mt-1 text-base text-muted-foreground sm:text-sm">
						{REASON_DESCRIPTIONS[reason]}
					</p>
				</div>
			</label>
		</li>
	);
}

function OrganizationSummary({
	organization,
}: {
	organization: ReportableOrganization;
}) {
	return (
		<Link
			to="/organizations/$identifier"
			params={{ identifier: organization.slug || organization.id }}
			className="flex items-center gap-4 border-border border-b pb-6"
		>
			<PublicOrganizationAvatar organization={organization} size="lg" />
			<div className="flex flex-col gap-0.5">
				<h2 className="font-medium text-xl tracking-tight">
					{organization.name}
				</h2>
				{organization.description ? (
					<p className="max-w-[62ch] text-base text-muted-foreground text-pretty sm:text-sm line-clamp-1">
						{organization.description}
					</p>
				) : null}
			</div>
		</Link>
	);
}

function SubmittedState({ reportId }: { reportId: string }) {
	return (
		<div className="rounded-md border border-emerald-600/20 bg-emerald-50 p-6 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-50">
			<div className="flex flex-col gap-2">
				<h2 className="font-medium text-base sm:text-2xl tracking-tight">
					Thank you for your report
				</h2>
				<p className="mt-1 text-base text-emerald-900 dark:text-emerald-100">
					Kayle's Trust and Safety team will review this report and take
					appropriate action.
				</p>
				<p className="mt-1 text-base text-emerald-900 dark:text-emerald-100">
					If you need to contact us further about this report, please use this
					reference ID:
				</p>
				<span className="font-mono font-semibold text-foreground border border-border rounded-md px-2 py-1 border-dashed w-fit text-sm mt-2.5">
					{reportId}
				</span>
			</div>
		</div>
	);
}

export function ReportOrganizationPage({
	error,
	organization,
	sessionId,
}: {
	error: null | string;
	organization: ReportableOrganization | null;
	sessionId: null | string;
}) {
	const [details, setDetails] = useState("");
	const [reason, setReason] = useState<"" | OrganizationReportReason>("");
	const [submittedReportId, setSubmittedReportId] = useState<null | string>(
		null,
	);
	const reasonGroupName = useId();
	const detailsId = useId();
	const submitMutation = useMutation({
		mutationFn: submitPublicOrganizationReport,
		onSuccess: (payload) => {
			setSubmittedReportId(payload.report_id);
		},
	});
	const isSubmitting = submitMutation.isPending;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();

		if (!(organization && reason) || isSubmitting || submittedReportId) {
			return;
		}

		submitMutation.mutate({
			details: details.trim() || null,
			organization_id: organization.id,
			reason,
			session_id: sessionId,
		});
	};

	return (
		<PublicPageShell>
			<section className="py-12 sm:py-16">
				<div className="mx-auto max-w-7xl px-6 lg:px-8">
					<ReportPageHeader
						description="Reports you send about an organization are reviewed by Kayle's trust and safety team."
						title="Report an organization"
					/>

					<div className="mt-8 max-w-3xl">
						{error || !organization ? (
							<div className="rounded-md border border-destructive/30 bg-destructive/5 p-6 text-base text-destructive sm:text-sm">
								<p>
									{error ??
										"The organization could not be found in the public directory."}
								</p>
								<Link
									className="mt-4 inline-flex font-medium underline decoration-destructive/40 underline-offset-4 hover:decoration-destructive"
									to="/organizations"
								>
									Back to organizations
								</Link>
							</div>
						) : submittedReportId ? (
							<SubmittedState reportId={submittedReportId} />
						) : (
							<form
								className="rounded-md border border-border p-5 sm:p-6"
								onSubmit={handleSubmit}
							>
								<OrganizationSummary organization={organization} />

								<fieldset
									className="mt-6"
									disabled={isSubmitting || Boolean(submittedReportId)}
								>
									<legend className="font-medium text-base sm:text-sm">
										Reason for report
									</legend>
									<ul className="mt-3 list-none divide-y divide-border rounded-md border border-border">
										{ORGANIZATION_REPORT_REASONS.map((option) => (
											<ReasonOption
												disabled={isSubmitting || Boolean(submittedReportId)}
												groupName={reasonGroupName}
												key={option}
												onSelect={setReason}
												reason={option}
												selectedReason={reason}
											/>
										))}
									</ul>
								</fieldset>

								<div className="mt-6 flex flex-col gap-2">
									<label
										className="font-medium text-base sm:text-sm"
										htmlFor={detailsId}
									>
										More details (optional)
									</label>
									<textarea
										className="min-h-32 resize-y rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 sm:text-sm"
										disabled={isSubmitting || Boolean(submittedReportId)}
										id={detailsId}
										maxLength={DETAILS_MAX_LENGTH}
										name="details"
										onChange={(event) => setDetails(event.target.value)}
										placeholder="Add context that will help Kayle review this report."
										value={details}
									/>
								</div>

								{submitMutation.error ? (
									<div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-base text-destructive sm:text-sm">
										<AlertCircle
											aria-hidden="true"
											className="mt-0.5 size-5 sm:size-4"
										/>
										<p>
											{submitMutation.error instanceof Error
												? submitMutation.error.message
												: "Unable to submit organization report."}
										</p>
									</div>
								) : null}

								<div className="mt-6 flex justify-end">
									<Button disabled={!reason || isSubmitting} type="submit">
										{isSubmitting ? (
											<Loader2
												aria-hidden="true"
												className="size-4 animate-spin"
											/>
										) : null}
										{isSubmitting ? "Submitting…" : "Submit report"}
									</Button>
								</div>
							</form>
						)}
					</div>
				</div>
			</section>
		</PublicPageShell>
	);
}
