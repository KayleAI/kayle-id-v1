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

function DocumentPortrait({ preview }: { preview: DemoDocumentPreview }) {
	const supportsInlineImage = preview.documentPhoto?.format === "jpeg";

	if (!(supportsInlineImage && preview.documentPhoto)) {
		return null;
	}

	return (
		<div className="overflow-hidden rounded-md bg-muted">
			<img
				alt="Document holder portrait"
				className="aspect-4/5 h-full w-full object-cover object-top"
				height={preview.documentPhoto.height}
				src={preview.documentPhoto.dataUri}
				width={preview.documentPhoto.width}
			/>
		</div>
	);
}

function ProfileFieldItem({
	className,
	label,
	monospace = false,
	value,
}: {
	className?: string;
	label: string;
	monospace?: boolean;
	value: string;
}) {
	return (
		<div className={className}>
			<dt className="font-medium text-muted-foreground text-sm">{label}</dt>
			<dd
				className={cn(
					"mt-1 wrap-break-word text-base text-foreground",
					monospace &&
						"break-all font-mono text-[0.92rem] tabular-nums tracking-[0.04em]",
				)}
			>
				{value}
			</dd>
		</div>
	);
}

function AgeGateStatusItem({
	className,
	passed,
	prominent = false,
	threshold,
}: {
	className?: string;
	passed: boolean;
	prominent?: boolean;
	threshold: number;
}) {
	const Icon = passed ? ShieldCheckIcon : ShieldAlertIcon;

	return (
		<div className={className}>
			<dt
				className={cn(
					"font-medium text-muted-foreground text-sm",
					prominent && "sr-only",
				)}
			>
				Age check
			</dt>
			<dd className={prominent ? "mt-5" : "mt-1"}>
				<div className="flex items-center gap-2.5">
					<Icon
						className={cn(
							"shrink-0",
							prominent ? "size-5" : "size-4",
							passed
								? "text-emerald-600 dark:text-emerald-400"
								: "text-red-600 dark:text-red-400",
						)}
					/>
					<span
						className={cn(
							prominent ? "font-light text-2xl tracking-tight" : "text-[1rem]",
							passed
								? "text-emerald-700 dark:text-emerald-300"
								: "text-red-700 dark:text-red-300",
						)}
					>
						{passed ? `${threshold} or older` : `Under ${threshold}`}
					</span>
				</div>
			</dd>
		</div>
	);
}

function ResultSectionHeading({
	description,
	title,
	variant = "default",
}: {
	description: string;
	title: string;
	variant?: "default" | "step";
}) {
	return (
		<div>
			<h3
				className={cn(
					"max-w-[22ch] text-balance text-foreground tracking-tight",
					variant === "step" ? "font-light text-2xl" : "font-medium text-xl",
				)}
			>
				{title}
			</h3>
			<p className="mt-1 max-w-[54ch] text-muted-foreground text-sm leading-6">
				{description}
			</p>
		</div>
	);
}

function WebhookPayloadDisclosure({
	payload,
	variant = "default",
}: {
	payload: string;
	variant?: "default" | "subtle";
}) {
	if (variant === "subtle") {
		return (
			<details className="group border-border/70 border-t pt-5">
				<summary className="flex cursor-pointer list-none items-center justify-between gap-4 marker:content-none">
					<span className="font-medium text-muted-foreground text-sm">
						Payload JSON
					</span>
					<span className="shrink-0 text-muted-foreground text-sm group-open:text-foreground">
						Show
					</span>
				</summary>

				<div className="mt-4 overflow-hidden rounded-lg border border-border/70">
					<pre className="max-h-88 overflow-auto bg-neutral-950 px-4 py-4 font-mono text-[0.78rem] text-neutral-100 leading-6">
						{payload}
					</pre>
				</div>
			</details>
		);
	}

	return (
		<details className="group">
			<summary className="flex cursor-pointer list-none flex-col gap-4 marker:content-none sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<p className="font-medium text-base text-foreground">Payload JSON</p>
					<p className="mt-2 max-w-[54ch] text-muted-foreground text-sm leading-6">
						Expand the verified JSON payload for a raw inspection view.
					</p>
				</div>
				<span className="shrink-0 font-medium text-[0.8rem] text-foreground/80">
					Show raw JSON
				</span>
			</summary>

			<div className="mt-5 overflow-hidden rounded-xl border border-border/70">
				<pre className="max-h-112 overflow-auto bg-neutral-950 px-4 py-4 font-mono text-[0.82rem] text-neutral-100 leading-6 sm:px-5 sm:py-5">
					{payload}
				</pre>
			</div>
		</details>
	);
}

export function DemoAgePreviewPanel({
	payload,
	preview,
}: {
	payload: string;
	preview: DemoDocumentPreview;
}) {
	const ageItem = buildSharedProfileItems(preview).find(
		(item) => item.kind === "age-gate",
	);

	return (
		<div className="space-y-6">
			{ageItem ? (
				<dl>
					<AgeGateStatusItem
						passed={ageItem.passed}
						prominent
						threshold={ageItem.threshold}
					/>
				</dl>
			) : (
				<p className="text-muted-foreground text-sm leading-6">
					The age check result is not available yet.
				</p>
			)}

			<WebhookPayloadDisclosure payload={payload} variant="subtle" />
		</div>
	);
}

export function DemoDocumentPreviewPanel({
	payload,
	preview,
}: {
	payload: string;
	preview: DemoDocumentPreview;
}) {
	const displayName = buildHolderDisplayName({
		familyName: preview.familyName,
		givenNames: preview.givenNames,
	});
	const hasDocumentPhoto = preview.documentPhoto?.format === "jpeg";
	const sharedItems = buildSharedProfileItems(preview);
	const returnedItems = [
		displayName
			? ({
					key: "holder_name",
					kind: "field",
					label: "Name",
					value: displayName,
				} satisfies SharedProfileItem)
			: null,
		...sharedItems.filter((item) => !item.key.includes("kayle")),
	].filter((item): item is SharedProfileItem => item !== null);

	return (
		<div className="space-y-6">
			{hasDocumentPhoto || returnedItems.length === 0 ? (
				<section>
					<div
						className={cn(
							"grid gap-6 lg:items-start",
							hasDocumentPhoto && "lg:grid-cols-[9rem_minmax(0,1fr)]",
						)}
					>
						{hasDocumentPhoto ? (
							<div className="w-24 sm:w-34">
								<DocumentPortrait preview={preview} />
							</div>
						) : null}
						{returnedItems.length === 0 ? (
							<div className="min-w-0">
								<p className="max-w-[54ch] text-muted-foreground text-sm leading-6">
									No requested details were returned.
								</p>
							</div>
						) : null}
					</div>
				</section>
			) : null}

			{returnedItems.length > 0 ? (
				<section>
					<dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{returnedItems.map((item) =>
							item.kind === "age-gate" ? (
								<AgeGateStatusItem
									className="rounded-md bg-muted/55 p-4"
									key={item.key}
									passed={item.passed}
									threshold={item.threshold}
								/>
							) : (
								<ProfileFieldItem
									className="rounded-md bg-muted/55 p-4"
									key={item.key}
									label={item.label}
									monospace={item.monospace}
									value={item.value}
								/>
							),
						)}
					</dl>
				</section>
			) : null}

			<section>
				<WebhookPayloadDisclosure payload={payload} variant="subtle" />
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
	const title = preview.failureTitle ?? preview.title;
	const description = preview.failureDescription ?? preview.description;

	return (
		<div className="space-y-6">
			<section>
				<ResultSectionHeading
					description={description}
					title={title}
					variant="step"
				/>
			</section>

			<section>
				<WebhookPayloadDisclosure payload={payload} variant="subtle" />
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
	if (preview.eventType === "verification.attempt.failed") {
		return (
			<DemoFailedAttemptPreviewPanel payload={payload} preview={preview} />
		);
	}

	return (
		<div className="space-y-6">
			<section>
				<ResultSectionHeading
					description={preview.description}
					title={preview.title}
					variant="step"
				/>
			</section>

			<section>
				<WebhookPayloadDisclosure payload={payload} variant="subtle" />
			</section>
		</div>
	);
}
