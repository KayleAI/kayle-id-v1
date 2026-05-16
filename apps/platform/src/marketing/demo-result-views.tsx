import {
	getClaimLabel,
	parseAgeOverThreshold,
} from "@kayle-id/config/share-claims";
import { cn } from "@kayleai/ui/utils/cn";
import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";
import {
	type DemoDocumentPreview,
	type DemoWebhookEventPreview,
	formatDemoClaimValue,
} from "@/marketing/demo-document";

const monospaceProfileClaims = new Set([
	"document_expiry_date",
	"document_number",
	"document_type_code",
	"kayle_document_id",
	"kayle_human_id",
	"mrz_optional_data",
]);

const profileClaimOrder = [
	"given_names",
	"family_name",
	"nationality_code",
	"date_of_birth",
	"sex_marker",
	"issuing_country_code",
	"document_number",
	"document_expiry_date",
	"mrz_optional_data",
	"document_type_code",
	"kayle_document_id",
	"kayle_human_id",
] as const;

const profileClaimOrderMap = new Map(
	profileClaimOrder.map((claimKey, index) => [claimKey, index]),
);

const profileClaimLabels: Record<string, string> = {
	date_of_birth: "Date of birth",
	document_expiry_date: "Expires",
	document_number: "Document number",
	document_type_code: "Document type",
	issuing_country_code: "Issuing country",
	kayle_document_id: "Document ID",
	kayle_human_id: "Human ID",
	mrz_optional_data: "Personal number",
	nationality_code: "Nationality",
	sex_marker: "Sex",
};

type SharedProfileItem =
	| {
			kind: "age-gate";
			key: string;
			passed: boolean;
			threshold: number;
	  }
	| {
			key: string;
			kind: "field";
			label: string;
			monospace?: boolean;
			value: string;
	  };

export interface WebhookMetadataItem {
	label: string;
	monospace?: boolean;
	value: string;
}

function buildHolderDisplayName({
	familyName,
	givenNames,
}: {
	familyName: string | null;
	givenNames: string | null;
}): string | null {
	return [givenNames, familyName].filter(Boolean).join(" ") || null;
}

function hasDocumentValue(value: string | null | undefined): value is string {
	return Boolean(value?.trim());
}

function getProfileClaimSortOrder(claimKey: string): number {
	const ageThreshold = parseAgeOverThreshold(claimKey);
	if (ageThreshold) {
		return profileClaimOrderMap.get("date_of_birth") ?? 0;
	}

	return (
		profileClaimOrderMap.get(claimKey as (typeof profileClaimOrder)[number]) ??
		profileClaimOrder.length + 1
	);
}

function getProfileClaimLabel(claimKey: string): string {
	return profileClaimLabels[claimKey] ?? getClaimLabel(claimKey);
}

function shouldSkipSharedProfileClaim(claimKey: string): boolean {
	return (
		claimKey === "document_photo" ||
		claimKey === "family_name" ||
		claimKey === "given_names"
	);
}

function buildSharedProfileItem({
	claimKey,
	preview,
}: {
	claimKey: string;
	preview: DemoDocumentPreview;
}): SharedProfileItem | null {
	if (shouldSkipSharedProfileClaim(claimKey)) {
		return null;
	}

	const ageThreshold = parseAgeOverThreshold(claimKey);
	if (ageThreshold) {
		const ageGateValue = preview.claims[claimKey];
		return typeof ageGateValue === "boolean"
			? {
					key: claimKey,
					kind: "age-gate",
					passed: ageGateValue,
					threshold: ageThreshold,
				}
			: null;
	}

	const rawValue = preview.claims[claimKey];
	if (rawValue === null || rawValue === undefined) {
		return null;
	}

	const value = formatDemoClaimValue(claimKey, rawValue);
	if (!hasDocumentValue(value) || value === "Not shared") {
		return null;
	}

	return {
		key: claimKey,
		kind: "field",
		label: getProfileClaimLabel(claimKey),
		monospace: monospaceProfileClaims.has(claimKey),
		value,
	};
}

function buildSharedProfileItems(
	preview: DemoDocumentPreview,
): SharedProfileItem[] {
	const claimKeys =
		preview.selectedFieldKeys.length > 0
			? preview.selectedFieldKeys
			: Object.keys(preview.claims);

	return [...new Set(claimKeys)]
		.sort((left, right) => {
			const orderDifference =
				getProfileClaimSortOrder(left) - getProfileClaimSortOrder(right);
			return orderDifference === 0
				? left.localeCompare(right)
				: orderDifference;
		})
		.map((claimKey) => buildSharedProfileItem({ claimKey, preview }))
		.filter((item): item is SharedProfileItem => item !== null);
}

export function buildWebhookMetadataItems(
	preview: DemoWebhookEventPreview,
): WebhookMetadataItem[] {
	const items: WebhookMetadataItem[] = [
		{
			label: "Event Type",
			monospace: true,
			value: preview.eventType ?? "Unknown",
		},
		{
			label: "Contract Version",
			monospace: true,
			value:
				preview.contractVersion === null
					? "Unknown"
					: String(preview.contractVersion),
		},
		{
			label: "Verification Session",
			monospace: true,
			value: preview.verificationSessionId ?? "Unknown",
		},
	];

	if (preview.verificationAttemptId) {
		items.push({
			label: "Verification Attempt",
			monospace: true,
			value: preview.verificationAttemptId,
		});
	}

	if (preview.failureCode) {
		items.push({
			label: "Failure Code",
			monospace: true,
			value: preview.failureCode,
		});
	}

	return items;
}

function DocumentPortrait({ preview }: { preview: DemoDocumentPreview }) {
	const supportsInlineImage = preview.documentPhoto?.format === "jpeg";

	return (
		<div className="overflow-hidden rounded-[1.75rem] border border-border/70 bg-muted">
			{supportsInlineImage && preview.documentPhoto ? (
				<img
					alt="Document holder portrait"
					className="aspect-4/5 h-full w-full object-cover object-top"
					height={preview.documentPhoto.height}
					src={preview.documentPhoto.dataUri}
					width={preview.documentPhoto.width}
				/>
			) : (
				<div className="relative aspect-4/5 bg-muted">
					<div className="absolute top-[18%] left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-foreground/10" />
					<div className="absolute bottom-[12%] left-1/2 h-[48%] w-[46%] -translate-x-1/2 rounded-t-[999px] rounded-b-[1.2rem] bg-foreground/10" />
				</div>
			)}
		</div>
	);
}

function ProfileFieldItem({
	label,
	monospace = false,
	value,
}: {
	label: string;
	monospace?: boolean;
	value: string;
}) {
	return (
		<div>
			<dt className="font-medium text-foreground text-sm">{label}</dt>
			<dd
				className={cn(
					"mt-1 break-words text-[1rem] text-foreground/80",
					monospace &&
						"break-all font-mono text-[0.92rem] text-foreground tabular-nums tracking-[0.04em]",
				)}
			>
				{value}
			</dd>
		</div>
	);
}

function AgeGateStatusItem({
	passed,
	threshold,
}: {
	passed: boolean;
	threshold: number;
}) {
	const Icon = passed ? ShieldCheckIcon : ShieldAlertIcon;

	return (
		<div>
			<dt className="font-medium text-foreground text-sm">Age check</dt>
			<dd className="mt-1">
				<div className="flex items-center gap-2.5">
					<Icon
						className={cn(
							"size-4 shrink-0",
							passed
								? "text-emerald-600 dark:text-emerald-400"
								: "text-red-600 dark:text-red-400",
						)}
					/>
					<span
						className={cn(
							"text-[1rem]",
							passed
								? "text-emerald-700 dark:text-emerald-300"
								: "text-red-700 dark:text-red-300",
						)}
					>
						{passed ? `Over ${threshold}` : `Under ${threshold}`}
					</span>
				</div>
			</dd>
		</div>
	);
}

function ResultSectionHeading({
	description,
	title,
}: {
	description: string;
	title: string;
}) {
	return (
		<div className="max-w-3xl">
			<h3 className="max-w-[18ch] text-balance text-2xl text-foreground tracking-tight">
				{title}
			</h3>
			<p className="mt-1.5 max-w-[54ch] text-pretty text-lg text-muted-foreground leading-6">
				{description}
			</p>
		</div>
	);
}

function WebhookMetadataGrid({
	columns = 2,
	items,
}: {
	columns?: 2 | 3;
	items: WebhookMetadataItem[];
}) {
	return (
		<dl
			className={cn(
				"grid gap-4",
				columns === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
			)}
		>
			{items.map((item) => (
				<div
					className="rounded-md bg-muted/40 p-4 sm:p-5"
					key={`${item.label}-${item.value}`}
				>
					<ProfileFieldItem
						label={item.label}
						monospace={item.monospace}
						value={item.value}
					/>
				</div>
			))}
		</dl>
	);
}

function WebhookPayloadDisclosure({ payload }: { payload: string }) {
	return (
		<details className="group">
			<summary className="flex cursor-pointer list-none flex-col gap-4 marker:content-none sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-base text-foreground">Payload JSON</p>
					<p className="mt-2 max-w-[54ch] text-pretty text-muted-foreground text-sm leading-6 sm:text-base">
						Expand the verified JSON payload for a raw inspection view.
					</p>
				</div>
				<span className="shrink-0 font-medium text-[0.8rem] text-foreground/80">
					Show raw JSON
				</span>
			</summary>

			<div className="mt-5 overflow-hidden rounded-4xl border border-border/70">
				<pre className="max-h-[28rem] overflow-auto bg-neutral-950 px-4 py-4 font-mono text-[0.82rem] text-neutral-100 leading-6 sm:px-5 sm:py-5">
					{payload}
				</pre>
			</div>
		</details>
	);
}

export function DemoDocumentPreviewPanel({
	payload,
	preview,
	webhookMetadataItems,
}: {
	payload: string;
	preview: DemoDocumentPreview;
	webhookMetadataItems: WebhookMetadataItem[];
}) {
	const displayName = buildHolderDisplayName({
		familyName: preview.familyName,
		givenNames: preview.givenNames,
	});
	const documentKindLabel =
		preview.documentKind === "id-card" ? "ID card" : "Passport";
	const sharedItems = buildSharedProfileItems(preview);
	const visibleItemCount = sharedItems.filter(
		(item) => !item.key.includes("kayle"),
	).length;

	return (
		<div className="divide-y divide-border/70">
			<section className="pb-6 sm:pb-8">
				<div className="grid gap-6 lg:grid-cols-[9rem_minmax(0,1fr)] lg:items-start">
					<div className="w-24 sm:w-34">
						<DocumentPortrait preview={preview} />
					</div>
					<div className="min-w-0">
						<h3 className="max-w-[16ch] text-balance text-2xl text-foreground capitalize tracking-tight">
							{displayName || "No name"}
						</h3>
						<p className="mt-1.5 max-w-[54ch] text-pretty text-lg text-muted-foreground leading-6">
							{visibleItemCount > 0
								? `${visibleItemCount} shared ${
										visibleItemCount === 1 ? "field" : "fields"
									} from the verified ${documentKindLabel.toLowerCase()} listed below.`
								: `Verified ${documentKindLabel.toLowerCase()} data is ready to inspect.`}
						</p>
					</div>
				</div>
			</section>

			{visibleItemCount > 0 ? (
				<section className="py-6 sm:py-8">
					<dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						{sharedItems.map((item) => {
							if (item.key.includes("kayle")) {
								return null;
							}

							return (
								<div
									className="rounded-md bg-muted/40 p-4 sm:p-5"
									key={item.key}
								>
									{item.kind === "age-gate" ? (
										<AgeGateStatusItem
											passed={item.passed}
											threshold={item.threshold}
										/>
									) : (
										<ProfileFieldItem
											label={item.label}
											monospace={item.monospace}
											value={item.value}
										/>
									)}
								</div>
							);
						})}
					</dl>
				</section>
			) : null}

			{webhookMetadataItems.length > 0 ? (
				<section className="py-6 sm:py-8">
					<WebhookMetadataGrid items={webhookMetadataItems} />
				</section>
			) : null}

			<section className="border-border/70 border-b py-6 sm:py-8">
				<WebhookPayloadDisclosure payload={payload} />
			</section>
		</div>
	);
}

export function DemoFailedAttemptPreviewPanel({
	payload,
	preview,
}: {
	payload: string;
	preview: DemoWebhookEventPreview;
}) {
	const metadataItems = buildWebhookMetadataItems(preview);
	const title = preview.failureTitle ?? preview.title;
	const description = preview.failureDescription ?? preview.description;

	return (
		<div className="divide-y divide-border/70">
			<section className="pb-6 sm:pb-8">
				<ResultSectionHeading description={description} title={title} />
			</section>

			<section className="py-6 sm:py-8">
				<WebhookMetadataGrid items={metadataItems} />
			</section>

			<section className="border-border/70 border-b py-6 sm:py-8">
				<WebhookPayloadDisclosure payload={payload} />
			</section>
		</div>
	);
}

export function DemoWebhookEventPreviewPanel({
	payload,
	preview,
}: {
	payload: string;
	preview: DemoWebhookEventPreview;
}) {
	const metadataItems = buildWebhookMetadataItems(preview);

	if (preview.eventType === "verification.attempt.failed") {
		return (
			<DemoFailedAttemptPreviewPanel payload={payload} preview={preview} />
		);
	}

	return (
		<div className="border-border/70 border-t">
			<section className="border-border/70 border-b py-6 sm:py-8">
				<ResultSectionHeading
					description={preview.description}
					title={preview.title}
				/>
			</section>

			<section className="border-border/70 border-b py-6 sm:py-8">
				<ResultSectionHeading
					description="Identifiers and metadata from the selected verified event."
					title="Event details"
				/>
				<div className="mt-6">
					<WebhookMetadataGrid items={metadataItems} />
				</div>
			</section>

			<section className="border-border/70 border-b py-6 sm:py-8">
				<ResultSectionHeading
					description="Inspect the webhook JSON exactly as it was verified."
					title="Raw payload"
				/>
				<div className="mt-6">
					<WebhookPayloadDisclosure payload={payload} />
				</div>
			</section>
		</div>
	);
}

export function DocumentStatePanel({
	description,
	title,
}: {
	description: string;
	title: string;
}) {
	return (
		<div className="border-border/70 border-t">
			<section className="border-border/70 border-b py-6 sm:py-8">
				<ResultSectionHeading description={description} title={title} />
			</section>
		</div>
	);
}
