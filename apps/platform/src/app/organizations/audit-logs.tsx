import { useAuth } from "@kayle-id/auth/client/provider";
import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Button } from "@kayleai/ui/button";
import { Calendar } from "@kayleai/ui/calendar";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import { Input } from "@kayleai/ui/input";
import { Label } from "@kayleai/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@kayleai/ui/popover";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@kayleai/ui/select";
import { Skeleton } from "@kayleai/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import {
	type InfiniteData,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CalendarIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { API_KEYS_QUERY_KEY, listApiKeys } from "@/app/api-keys/api";
import { AppHeading } from "@/components/app-shell/heading";
import { RelativeTime } from "@/components/relative-time";
import {
	type AuditLogEntry,
	type AuditLogPage,
	type AuditLogsListInput,
	fetchFullOrganization,
	listAuditLogs,
	ORGANIZATION_AUDIT_LOGS_QUERY_KEY,
	ORGANIZATION_QUERY_KEY,
	type OrganizationRole,
} from "./api";

/**
 * Mirrors `react-day-picker`'s `DateRange` so we don't have to add the
 * transitive dependency to the platform's package.json. The shape exactly
 * matches the type the underlying `Calendar` component passes to `onSelect`
 * — `from` is required but its value can be `undefined`, mirroring the
 * upstream definition.
 */
interface AuditDateRange {
	from: Date | undefined;
	to?: Date;
}

const PAGE_SIZE = 50;

const ALL_ACTORS_VALUE = "__all__";
const SYSTEM_ACTOR_VALUE = "__system__";
const API_KEY_ACTOR_PREFIX = "apikey:";
const SEARCH_DEBOUNCE_MS = 300;

interface EventDescriptor {
	category: "Sessions" | "Organization" | "Members" | "Domains" | "Developers";
	event: string;
	label: string;
}

/**
 * Mapping from raw event names to a human-readable label and a high-level
 * category. Keep in sync with `AUDIT_LOG_EVENTS` in `packages/auth/src/audit-logs.ts`.
 */
const EVENT_DESCRIPTORS: readonly EventDescriptor[] = [
	{ category: "Sessions", event: "session.created", label: "Session created" },
	{
		category: "Sessions",
		event: "session.cancelled",
		label: "Session cancelled",
	},
	{ category: "Sessions", event: "session.expired", label: "Session expired" },
	{
		category: "Sessions",
		event: "session.succeeded",
		label: "Session succeeded",
	},
	{
		category: "Sessions",
		event: "session.attempt.failed",
		label: "Session attempt failed",
	},
	{
		category: "Sessions",
		event: "session.failed",
		label: "Session failed (retries exhausted)",
	},
	{
		category: "Organization",
		event: "organization.public_details.updated",
		label: "Public details updated",
	},
	{
		category: "Organization",
		event: "organization.logo.updated",
		label: "Logo updated",
	},
	{
		category: "Organization",
		event: "organization.business_details.updated",
		label: "Business details updated",
	},
	{
		category: "Organization",
		event: "organization.ownership.assigned",
		label: "Ownership assigned",
	},
	{
		category: "Domains",
		event: "domain.challenge.started",
		label: "Domain challenge started",
	},
	{ category: "Domains", event: "domain.verified", label: "Domain verified" },
	{ category: "Domains", event: "domain.removed", label: "Domain removed" },
	{
		category: "Domains",
		event: "domain.downgraded",
		label: "Domain downgraded",
	},
	{
		category: "Domains",
		event: "redirect_uri.added",
		label: "Redirect URI added",
	},
	{
		category: "Domains",
		event: "redirect_uri.removed",
		label: "Redirect URI removed",
	},
	{ category: "Members", event: "member.invited", label: "Member invited" },
	{
		category: "Members",
		event: "member.invitation.cancelled",
		label: "Invitation cancelled",
	},
	{ category: "Members", event: "member.joined", label: "Member joined" },
	{ category: "Members", event: "member.removed", label: "Member removed" },
	{
		category: "Members",
		event: "member.role.changed",
		label: "Member role changed",
	},
	{
		category: "Developers",
		event: "api_key.created",
		label: "API key created",
	},
	{
		category: "Developers",
		event: "api_key.updated",
		label: "API key updated",
	},
	{
		category: "Developers",
		event: "api_key.deleted",
		label: "API key deleted",
	},
	{
		category: "Developers",
		event: "webhook_endpoint.created",
		label: "Webhook endpoint created",
	},
	{
		category: "Developers",
		event: "webhook_endpoint.updated",
		label: "Webhook endpoint updated",
	},
	{
		category: "Developers",
		event: "webhook_endpoint.deleted",
		label: "Webhook endpoint deleted",
	},
	{
		category: "Developers",
		event: "webhook_endpoint.signing_secret.rotated",
		label: "Webhook signing secret rotated",
	},
] as const;

const EVENT_DESCRIPTOR_MAP: ReadonlyMap<string, EventDescriptor> = new Map(
	EVENT_DESCRIPTORS.map((d) => [d.event, d]),
);

const EVENT_CATEGORIES: readonly EventDescriptor["category"][] = [
	"Sessions",
	"Organization",
	"Members",
	"Domains",
	"Developers",
];

interface QuickRange {
	days: number;
	label: string;
}

const QUICK_RANGES: readonly QuickRange[] = [
	{ days: 1, label: "Last 24 hours" },
	{ days: 7, label: "Last 7 days" },
	{ days: 30, label: "Last 30 days" },
	{ days: 90, label: "Last 90 days" },
] as const;

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function describeEvent(event: string): {
	category: string | null;
	label: string;
} {
	const descriptor = EVENT_DESCRIPTOR_MAP.get(event);
	if (!descriptor) {
		return { category: null, label: event };
	}
	return { category: descriptor.category, label: descriptor.label };
}

function startOfDayISO(date: Date): string {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d.toISOString();
}

function endOfDayISO(date: Date): string {
	const d = new Date(date);
	d.setHours(23, 59, 59, 999);
	return d.toISOString();
}

function metadataString(
	metadata: Record<string, unknown>,
	key: string,
): string | null {
	const raw = metadata[key];
	return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function metadataBoolean(
	metadata: Record<string, unknown>,
	key: string,
): boolean | null {
	const raw = metadata[key];
	return typeof raw === "boolean" ? raw : null;
}

function metadataStringList(
	metadata: Record<string, unknown>,
	key: string,
): string[] | null {
	const raw = metadata[key];
	if (!Array.isArray(raw)) {
		return null;
	}
	return raw.filter((item): item is string => typeof item === "string");
}

/**
 * One-line context summary derived from an entry's event + metadata. Returns
 * `null` when no useful summary can be constructed — the caller should fall
 * back to nothing rather than showing an awkward placeholder.
 */
function summariseEntry(entry: AuditLogEntry): string | null {
	const meta = entry.metadata;
	switch (entry.event) {
		case "session.attempt.failed":
		case "session.failed": {
			const code = metadataString(meta, "failure_code");
			return code ? code.replaceAll("_", " ") : null;
		}
		case "organization.public_details.updated":
		case "organization.business_details.updated":
		case "webhook_endpoint.updated":
		case "api_key.updated": {
			const fields = metadataStringList(meta, "updated_fields");
			const enabled = metadataBoolean(meta, "enabled");
			if (enabled !== null) {
				return enabled ? "Enabled" : "Disabled";
			}
			return fields && fields.length > 0
				? `Updated ${fields.join(", ")}`
				: null;
		}
		case "domain.challenge.started":
		case "domain.verified":
		case "domain.removed":
		case "domain.downgraded":
			return metadataString(meta, "apex_domain");
		case "redirect_uri.added":
		case "redirect_uri.removed":
			return metadataString(meta, "pattern");
		case "member.invited":
		case "member.invitation.cancelled":
			return metadataString(meta, "email");
		case "member.role.changed": {
			const previous = metadataString(meta, "previous_role");
			const next = metadataString(meta, "new_role");
			if (previous && next) {
				return `${previous} → ${next}`;
			}
			return null;
		}
		case "organization.ownership.assigned": {
			const previous = metadataString(meta, "previous_role");
			const next = metadataString(meta, "new_role");
			return previous && next ? `${previous} → ${next}` : "Promoted to owner";
		}
		case "api_key.created":
		case "api_key.deleted":
			return metadataString(meta, "name");
		case "webhook_endpoint.created":
			return metadataString(meta, "url");
		default:
			return null;
	}
}

/**
 * Resolve an audit-log row's target — by `(targetType, targetId)` — to a
 * client-side route path that surfaces the resource. Returns `null` for
 * targets we don't have a per-resource page for; the caller falls back to
 * rendering plain monospace text in that case.
 */
function targetLinkFor(
	targetType: string | null,
	targetId: string | null,
): string | null {
	if (!(targetId && targetType)) {
		return null;
	}
	switch (targetType) {
		case "webhook_endpoint":
			return `/webhooks/${targetId}`;
		case "api_key":
			return `/api-keys/${targetId}`;
		case "verified_domain":
		case "domain_challenge":
		case "redirect_uri":
			return "/organizations/domains";
		case "member":
		case "invitation":
			return "/organizations/members";
		case "organization":
			return "/organizations";
		default:
			return null;
	}
}

/**
 * Resolve a single metadata key/value pair to a route, when it points at
 * another linkable resource (e.g. `actor_api_key_id` is the API key id of
 * the caller for system-actor rows).
 */
function metadataLinkFor(key: string, value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0) {
		return null;
	}
	switch (key) {
		case "actor_api_key_id":
			return `/api-keys/${value}`;
		default:
			return null;
	}
}

function describeRange(range: AuditDateRange | undefined): string | null {
	if (!range?.from) {
		return null;
	}
	const from = SHORT_DATE_FORMATTER.format(range.from);
	if (range.to) {
		const to = SHORT_DATE_FORMATTER.format(range.to);
		if (from === to) {
			return from;
		}
		return `${from} – ${to}`;
	}
	return from;
}

function AuditLogsSkeleton() {
	return (
		<div className="space-y-3">
			{["a", "b", "c", "d", "e"].map((key) => (
				<Skeleton className="h-12 w-full" key={key} />
			))}
		</div>
	);
}

function ActorCell({ entry }: { entry: AuditLogEntry }) {
	if (entry.actor.type === "system") {
		return <span className="text-muted-foreground text-sm">System</span>;
	}
	if (entry.actor.type === "api_key") {
		const keyLabel = entry.actor.apiKeyName ?? "Deleted API key";
		const keyId = entry.actor.apiKeyId;
		return (
			<div className="flex flex-col">
				{keyId ? (
					<Link
						className="text-foreground text-sm underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
						onClick={(event) => event.stopPropagation()}
						to={`/api-keys/${keyId}` as never}
					>
						{keyLabel}
					</Link>
				) : (
					<span className="text-foreground text-sm">{keyLabel}</span>
				)}
				<span className="text-muted-foreground text-xs">API key</span>
			</div>
		);
	}
	return (
		<span className="text-foreground text-sm">
			{entry.actor.name ?? entry.actor.email ?? "Removed user"}
		</span>
	);
}

/**
 * Curated, human-readable labels for metadata keys we know about. Anything
 * not in this map falls back to a generic snake_case → Sentence-case
 * conversion in `humanizeMetadataKey`.
 */
const HUMAN_METADATA_LABELS: Readonly<Record<string, string>> = {
	actor_api_key_id: "API key",
	apex_domain: "Domain",
	attempt_id: "Attempt",
	consecutive_failed_checks: "Consecutive failed checks",
	email: "Email",
	enabled: "Enabled",
	failed_attempts: "Failed attempts",
	failure_code: "Failure",
	has_conflict: "Conflict detected",
	is_age_only: "Age-only",
	method: "Method",
	name: "Name",
	new_role: "New role",
	pattern: "Pattern",
	permissions: "Permissions",
	previous_role: "Previous role",
	role: "Role",
	share_field_count: "Share fields",
	takeover_from_organization_id: "Took over from",
	updated_fields: "Updated fields",
	url: "URL",
	user_id: "Member",
	verified_domain_id: "Verified domain",
};

function humanizeMetadataKey(key: string): string {
	const explicit = HUMAN_METADATA_LABELS[key];
	if (explicit) {
		return explicit;
	}
	// Generic fallback: drop a trailing `_id`, split snake_case, sentence-case.
	const trimmed = key.replace(/_id$/, "");
	const words = trimmed.split("_").filter(Boolean);
	if (words.length === 0) {
		return key;
	}
	const [first, ...rest] = words;
	return [
		(first ?? "").charAt(0).toUpperCase() + (first ?? "").slice(1),
		...rest,
	].join(" ");
}

/**
 * Render a snake_case or camelCase column/field identifier as a sentence-case
 * phrase. Used to humanize each entry of an `updated_fields`-style array and
 * the `failure_code` string.
 */
function humanizeIdentifier(input: string): string {
	const spaced = input
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replaceAll("_", " ")
		.toLowerCase()
		.trim();
	if (!spaced) {
		return input;
	}
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeMetadataValue(value: unknown, key: string): string {
	if (value === null || value === undefined) {
		return "None";
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (Array.isArray(value)) {
		const items = value.map((item) => String(item));
		if (
			key === "updated_fields" ||
			key === "permissions" ||
			key === "share_fields"
		) {
			return items.map(humanizeIdentifier).join(", ");
		}
		return items.join(", ");
	}
	if (typeof value === "string") {
		if (key === "failure_code") {
			return humanizeIdentifier(value);
		}
		return value;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return JSON.stringify(value);
}

interface ResourceReferenceProps {
	fallback: string;
	href: string | null;
}

function ResourceReference({ fallback, href }: ResourceReferenceProps) {
	if (!href) {
		return <>{fallback}</>;
	}
	// `to` is typed against TanStack Router's known route tree. We pass strings
	// resolved by `targetLinkFor`/`metadataLinkFor`, so the route may carry a
	// param we computed dynamically. Cast to a known route key shape via
	// `unknown` because the exhaustive route literal type is internal.
	return (
		<Link
			className="text-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:decoration-foreground"
			onClick={(event) => event.stopPropagation()}
			to={href as never}
		>
			{fallback}
		</Link>
	);
}

interface AuditLogRowProps {
	entry: AuditLogEntry;
	onToggle: () => void;
	open: boolean;
}

function AuditLogRow({ entry, onToggle, open }: AuditLogRowProps) {
	const { label } = describeEvent(entry.event);
	const summary = summariseEntry(entry);
	const metadataKeys = Object.keys(entry.metadata);

	return (
		<>
			<TableRow
				className="cursor-pointer transition-colors hover:bg-muted/40 data-[state=open]:bg-muted/40"
				data-state={open ? "open" : "closed"}
				onClick={onToggle}
			>
				<TableCell className="align-top">
					<div className="flex items-start gap-2">
						<button
							aria-expanded={open}
							aria-label={open ? "Collapse details" : "Expand details"}
							className="mt-0.5 rounded text-muted-foreground hover:text-foreground"
							onClick={(event) => {
								event.stopPropagation();
								onToggle();
							}}
							type="button"
						>
							{open ? (
								<ChevronDownIcon className="size-4" />
							) : (
								<ChevronRightIcon className="size-4" />
							)}
						</button>
						<div className="flex min-w-0 flex-col">
							<span className="font-medium text-foreground text-sm">
								{label}
							</span>
							{summary ? (
								<span className="truncate text-muted-foreground text-xs">
									{summary}
								</span>
							) : null}
						</div>
					</div>
				</TableCell>
				<TableCell className="align-top">
					<ActorCell entry={entry} />
				</TableCell>
				<TableCell className="whitespace-nowrap text-right align-top text-muted-foreground text-sm">
					<RelativeTime
						className="cursor-default"
						iso={entry.createdAt}
						onClick={(event) => event.stopPropagation()}
						side="left"
					/>
				</TableCell>
			</TableRow>
			{open ? (
				<TableRow className="bg-muted/30">
					<TableCell className="border-t-0 py-3" colSpan={3}>
						<dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[140px_1fr]">
							<dt className="text-muted-foreground">Event</dt>
							<dd className="break-all font-mono">{entry.event}</dd>

							<dt className="text-muted-foreground">When</dt>
							<dd>
								<RelativeTime format="absolute" iso={entry.createdAt} />
							</dd>

							{entry.targetType ? (
								<>
									<dt className="text-muted-foreground">Target type</dt>
									<dd>{entry.targetType}</dd>
								</>
							) : null}
							{entry.targetId ? (
								<>
									<dt className="text-muted-foreground">Target ID</dt>
									<dd className="break-all font-mono">
										<ResourceReference
											fallback={entry.targetId}
											href={targetLinkFor(entry.targetType, entry.targetId)}
										/>
									</dd>
								</>
							) : null}

							<dt className="text-muted-foreground">Entry ID</dt>
							<dd className="break-all font-mono">{entry.id}</dd>

							{metadataKeys.length > 0 ? (
								<>
									<dt className="self-start text-muted-foreground">Metadata</dt>
									<dd>
										<dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
											{metadataKeys.map((key) => {
												const rawValue = entry.metadata[key];
												const link = metadataLinkFor(key, rawValue);
												const humanLabel = humanizeMetadataKey(key);
												const humanValue = humanizeMetadataValue(rawValue, key);
												return (
													<div className="contents" key={key}>
														<dt className="text-muted-foreground">
															{humanLabel}
														</dt>
														<dd className="break-all">
															{link ? (
																<ResourceReference
																	fallback={humanValue}
																	href={link}
																/>
															) : (
																humanValue
															)}
														</dd>
													</div>
												);
											})}
										</dl>
									</dd>
								</>
							) : null}
						</dl>
					</TableCell>
				</TableRow>
			) : null}
		</>
	);
}

function AuditLogsTable({ entries }: { entries: AuditLogEntry[] }) {
	const [openId, setOpenId] = useState<string | null>(null);

	if (entries.length === 0) {
		return (
			<Card>
				<CardContent className="py-12 text-center text-muted-foreground text-sm">
					No audit log entries match the current filter. They appear as members
					and integrations make changes to this organization.
				</CardContent>
			</Card>
		);
	}
	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<Table>
				<TableHeader className="bg-muted/40">
					<TableRow>
						<TableHead>Event</TableHead>
						<TableHead>Actor</TableHead>
						<TableHead className="text-right">When</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{entries.map((entry) => (
						<AuditLogRow
							entry={entry}
							key={entry.id}
							onToggle={() =>
								setOpenId((current) => (current === entry.id ? null : entry.id))
							}
							open={openId === entry.id}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

interface SearchInputProps {
	onChange: (next: string) => void;
	value: string;
}

function SearchInput({ onChange, value }: SearchInputProps) {
	return (
		<div className="relative w-full sm:w-72">
			<SearchIcon
				aria-hidden
				className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
			/>
			<Input
				aria-label="Search audit logs"
				className="pl-9"
				onChange={(event) => onChange(event.target.value)}
				placeholder="Search event, target, actor…"
				type="search"
				value={value}
			/>
			{value ? (
				<button
					aria-label="Clear search"
					className="-translate-y-1/2 absolute top-1/2 right-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
					onClick={() => onChange("")}
					type="button"
				>
					<XIcon className="size-3.5" />
				</button>
			) : null}
		</div>
	);
}

interface EventFilterProps {
	onChange: (next: string[]) => void;
	value: string[];
}

function summariseEventSelection(selected: readonly string[]): string {
	if (selected.length === 0) {
		return "All events";
	}
	if (selected.length === 1) {
		return describeEvent(selected[0] ?? "").label;
	}
	return `${selected.length} events`;
}

function EventFilter({ onChange, value }: EventFilterProps) {
	return (
		<Select
			multiple
			onValueChange={(next) => {
				// `next` is an array when `multiple`. Coerce defensively because
				// the underlying type is broad enough to also include null.
				if (Array.isArray(next)) {
					onChange(
						next.filter((item): item is string => typeof item === "string"),
					);
					return;
				}
				onChange([]);
			}}
			value={value}
		>
			<SelectTrigger aria-label="Filter by event" className="w-[220px]">
				<SelectValue>
					{(raw) => {
						const selected = Array.isArray(raw)
							? raw.filter((item): item is string => typeof item === "string")
							: [];
						return (
							<span
								className={
									selected.length === 0 ? "text-muted-foreground" : undefined
								}
							>
								{summariseEventSelection(selected)}
							</span>
						);
					}}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				{EVENT_CATEGORIES.map((category) => {
					const eventsInCategory = EVENT_DESCRIPTORS.filter(
						(d) => d.category === category,
					);
					if (eventsInCategory.length === 0) {
						return null;
					}
					return (
						<SelectGroup key={category}>
							<SelectLabel>{category}</SelectLabel>
							{eventsInCategory.map((descriptor) => (
								<SelectItem key={descriptor.event} value={descriptor.event}>
									{descriptor.label}
								</SelectItem>
							))}
						</SelectGroup>
					);
				})}
			</SelectContent>
		</Select>
	);
}

interface ActorOption {
	id: string;
	label: string;
	sublabel?: string;
}

interface ActorFilterProps {
	apiKeys: ActorOption[];
	members: ActorOption[];
	onChange: (next: string) => void;
	value: string;
}

function ActorFilter({ apiKeys, members, onChange, value }: ActorFilterProps) {
	const labelFor = (raw: unknown): string => {
		if (raw === ALL_ACTORS_VALUE || typeof raw !== "string" || !raw) {
			return "All actors";
		}
		if (raw === SYSTEM_ACTOR_VALUE) {
			return "System";
		}
		if (raw.startsWith(API_KEY_ACTOR_PREFIX)) {
			const id = raw.slice(API_KEY_ACTOR_PREFIX.length);
			return apiKeys.find((k) => k.id === id)?.label ?? "Unknown API key";
		}
		return members.find((m) => m.id === raw)?.label ?? "Unknown actor";
	};
	return (
		<Select
			onValueChange={(next) =>
				onChange(typeof next === "string" ? next : ALL_ACTORS_VALUE)
			}
			value={value}
		>
			<SelectTrigger aria-label="Filter by actor" className="w-[200px]">
				<SelectValue>
					{(raw) => (
						<span
							className={
								raw === ALL_ACTORS_VALUE ? "text-muted-foreground" : undefined
							}
						>
							{labelFor(raw)}
						</span>
					)}
				</SelectValue>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value={ALL_ACTORS_VALUE}>All actors</SelectItem>
				<SelectItem value={SYSTEM_ACTOR_VALUE}>System</SelectItem>
				{members.length > 0 ? (
					<SelectGroup>
						<SelectLabel>Members</SelectLabel>
						{members.map((member) => (
							<SelectItem key={member.id} value={member.id}>
								{member.label}
							</SelectItem>
						))}
					</SelectGroup>
				) : null}
				{apiKeys.length > 0 ? (
					<SelectGroup>
						<SelectLabel>API keys</SelectLabel>
						{apiKeys.map((key) => (
							<SelectItem
								key={key.id}
								value={`${API_KEY_ACTOR_PREFIX}${key.id}`}
							>
								{key.label}
							</SelectItem>
						))}
					</SelectGroup>
				) : null}
			</SelectContent>
		</Select>
	);
}

interface DateRangeFilterProps {
	onChange: (next: AuditDateRange | undefined) => void;
	value: AuditDateRange | undefined;
}

function DateRangeFilter({ onChange, value }: DateRangeFilterProps) {
	const [open, setOpen] = useState(false);
	const label = describeRange(value) ?? "All time";

	const applyQuickRange = (days: number) => {
		const now = new Date();
		const from = new Date(now);
		from.setDate(now.getDate() - days);
		onChange({ from, to: now });
		setOpen(false);
	};

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<Button
						aria-label="Filter by date range"
						className="h-9 justify-start gap-2 font-normal"
						variant="outline"
					>
						<CalendarIcon className="size-4 text-muted-foreground" />
						<span className={value?.from ? "" : "text-muted-foreground"}>
							{label}
						</span>
					</Button>
				}
			/>
			<PopoverContent
				align="start"
				className="w-auto p-0"
				side="bottom"
				sideOffset={6}
			>
				<div className="flex flex-col gap-2 p-3 sm:flex-row">
					<div className="flex w-full flex-col gap-1 sm:w-40">
						<Label className="text-muted-foreground text-xs uppercase tracking-wide">
							Quick ranges
						</Label>
						{QUICK_RANGES.map((range) => (
							<Button
								className="justify-start font-normal"
								key={range.label}
								onClick={() => applyQuickRange(range.days)}
								size="sm"
								variant="ghost"
							>
								{range.label}
							</Button>
						))}
						{value?.from ? (
							<Button
								className="justify-start font-normal text-destructive"
								onClick={() => {
									onChange(undefined);
									setOpen(false);
								}}
								size="sm"
								variant="ghost"
							>
								Clear range
							</Button>
						) : null}
					</div>
					<div className="border-border border-t pt-2 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-2">
						<Calendar
							captionLayout="dropdown"
							mode="range"
							numberOfMonths={2}
							onSelect={onChange}
							selected={value}
						/>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

interface FilterToolbarProps {
	actorFilter: string;
	apiKeyOptions: ActorOption[];
	dateRange: AuditDateRange | undefined;
	eventFilter: string[];
	hasAnyActiveFilter: boolean;
	memberOptions: ActorOption[];
	onActorChange: (next: string) => void;
	onClearAll: () => void;
	onDateRangeChange: (next: AuditDateRange | undefined) => void;
	onEventChange: (next: string[]) => void;
	onSearchChange: (next: string) => void;
	searchInput: string;
}

function FilterToolbar({
	actorFilter,
	apiKeyOptions,
	dateRange,
	eventFilter,
	hasAnyActiveFilter,
	memberOptions,
	onActorChange,
	onClearAll,
	onDateRangeChange,
	onEventChange,
	onSearchChange,
	searchInput,
}: FilterToolbarProps) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<SearchInput onChange={onSearchChange} value={searchInput} />
			<EventFilter onChange={onEventChange} value={eventFilter} />
			<ActorFilter
				apiKeys={apiKeyOptions}
				members={memberOptions}
				onChange={onActorChange}
				value={actorFilter}
			/>
			<DateRangeFilter onChange={onDateRangeChange} value={dateRange} />
			{hasAnyActiveFilter ? (
				<Button
					className="ml-auto"
					onClick={onClearAll}
					size="sm"
					variant="ghost"
				>
					Clear all
				</Button>
			) : null}
		</div>
	);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

export function OrganizationAuditLogsPage() {
	const { user } = useAuth();
	const orgQuery = useQuery({
		queryFn: fetchFullOrganization,
		queryKey: ORGANIZATION_QUERY_KEY,
		staleTime: 30_000,
	});

	const currentRole = orgQuery.data?.members.find(
		(member) => member.userId === user?.id,
	)?.role as OrganizationRole | undefined;
	const canView = currentRole === "owner" || currentRole === "admin";

	const memberOptions = useMemo<ActorOption[]>(
		() =>
			// Include suspended members so historical filtering still works after
			// someone leaves the org. Active members come first; suspended ones
			// are appended with a label suffix so they're easy to distinguish.
			[
				...(orgQuery.data?.members ?? []).filter((m) => !m.suspendedAt),
				...(orgQuery.data?.members ?? []).filter((m) => m.suspendedAt),
			].map((member) => {
				const baseLabel =
					member.user.name?.trim() || member.user.email || "Member";
				return {
					id: member.user.id,
					label: member.suspendedAt ? `${baseLabel} (suspended)` : baseLabel,
					sublabel: member.user.email,
				};
			}),
		[orgQuery.data?.members],
	);

	const apiKeysQuery = useQuery({
		enabled: canView,
		queryFn: listApiKeys,
		queryKey: API_KEYS_QUERY_KEY,
		staleTime: 30_000,
	});
	const apiKeyOptions = useMemo<ActorOption[]>(
		() =>
			(apiKeysQuery.data?.data ?? []).map((key) => ({
				id: key.id,
				label: key.name?.trim() || `Key ${key.id.slice(0, 8)}`,
			})),
		[apiKeysQuery.data?.data],
	);

	const [eventFilter, setEventFilter] = useState<string[]>([]);
	const [actorFilter, setActorFilter] = useState<string>(ALL_ACTORS_VALUE);
	const [dateRange, setDateRange] = useState<AuditDateRange | undefined>(
		undefined,
	);
	const [searchInput, setSearchInput] = useState<string>("");
	const debouncedSearch = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);

	const activeEvents: readonly string[] = eventFilter;
	const eventsKey = activeEvents.join(",");
	// Decode the actor-filter sentinel into the matching API filter shape:
	// `__system__` → `actor_type=system`, `apikey:<id>` → `actor_api_key_id`,
	// any other UUID → `actor_user_id`, sentinels for "all" → no filter.
	const isApiKeyActor = actorFilter.startsWith(API_KEY_ACTOR_PREFIX);
	const activeActorApiKeyId: string | undefined = isApiKeyActor
		? actorFilter.slice(API_KEY_ACTOR_PREFIX.length)
		: undefined;
	const activeActorUserId: string | undefined =
		actorFilter === ALL_ACTORS_VALUE ||
		actorFilter === SYSTEM_ACTOR_VALUE ||
		isApiKeyActor
			? undefined
			: actorFilter;
	const activeActorType: "system" | undefined =
		actorFilter === SYSTEM_ACTOR_VALUE ? "system" : undefined;
	const activeCreatedFrom = dateRange?.from
		? startOfDayISO(dateRange.from)
		: undefined;
	const activeCreatedTo = dateRange?.to
		? endOfDayISO(dateRange.to)
		: dateRange?.from
			? endOfDayISO(dateRange.from)
			: undefined;
	const trimmedSearch = debouncedSearch.trim();
	const activeSearch = trimmedSearch.length > 0 ? trimmedSearch : undefined;

	const hasAnyActiveFilter = Boolean(
		activeEvents.length > 0 ||
			activeActorUserId ||
			activeActorApiKeyId ||
			activeActorType ||
			activeCreatedFrom ||
			activeCreatedTo ||
			activeSearch,
	);

	const filters: AuditLogsListInput = useMemo(
		() => ({
			actorApiKeyId: activeActorApiKeyId,
			actorType: activeActorType,
			actorUserId: activeActorUserId,
			createdFrom: activeCreatedFrom,
			createdTo: activeCreatedTo,
			// Re-derive from the stable string key so a fresh array reference
			// (when nothing actually changed) doesn't churn the query cache.
			events: eventsKey ? eventsKey.split(",") : [],
			q: activeSearch,
		}),
		[
			activeActorApiKeyId,
			activeActorType,
			activeActorUserId,
			activeCreatedFrom,
			activeCreatedTo,
			eventsKey,
			activeSearch,
		],
	);

	const auditQuery = useInfiniteQuery<
		AuditLogPage,
		Error,
		InfiniteData<AuditLogPage, string | null>,
		readonly unknown[],
		string | null
	>({
		enabled: canView,
		getNextPageParam: (lastPage) =>
			lastPage.pagination.has_more ? lastPage.pagination.next_cursor : null,
		initialPageParam: null,
		queryFn: ({ pageParam }) =>
			listAuditLogs({
				...filters,
				limit: PAGE_SIZE,
				startingAfter: pageParam ?? undefined,
			}),
		queryKey: [...ORGANIZATION_AUDIT_LOGS_QUERY_KEY, filters],
	});

	const entries = useMemo(
		() => auditQuery.data?.pages.flatMap((page) => page.data) ?? [],
		[auditQuery.data],
	);

	const handleClearAll = () => {
		setEventFilter([]);
		setActorFilter(ALL_ACTORS_VALUE);
		setDateRange(undefined);
		setSearchInput("");
	};

	return (
		<div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col w-full">
			<AppHeading title="Audit logs" />
			<hr className="my-8" />

			{!canView && orgQuery.data ? (
				<Card>
					<CardHeader>
						<CardTitle>Restricted</CardTitle>
						<CardDescription>
							Audit logs are visible to organization owners and admins only. Ask
							an owner or admin of this organization to share the log with you.
						</CardDescription>
					</CardHeader>
				</Card>
			) : null}

			{canView ? (
				<div className="space-y-4">
					<FilterToolbar
						actorFilter={actorFilter}
						apiKeyOptions={apiKeyOptions}
						dateRange={dateRange}
						eventFilter={eventFilter}
						hasAnyActiveFilter={hasAnyActiveFilter}
						memberOptions={memberOptions}
						onActorChange={setActorFilter}
						onClearAll={handleClearAll}
						onDateRangeChange={setDateRange}
						onEventChange={setEventFilter}
						onSearchChange={setSearchInput}
						searchInput={searchInput}
					/>

					{auditQuery.isError ? (
						<Alert variant="destructive">
							<AlertTitle>Failed to load audit logs</AlertTitle>
							<AlertDescription>
								{auditQuery.error instanceof Error
									? auditQuery.error.message
									: "Something went wrong while loading audit logs."}
							</AlertDescription>
						</Alert>
					) : null}

					{auditQuery.isLoading ? (
						<AuditLogsSkeleton />
					) : (
						<AuditLogsTable entries={entries} />
					)}

					{auditQuery.hasNextPage ? (
						<div className="flex justify-center">
							<Button
								disabled={auditQuery.isFetchingNextPage}
								onClick={() => auditQuery.fetchNextPage()}
								variant="outline"
							>
								{auditQuery.isFetchingNextPage ? "Loading..." : "Load more"}
							</Button>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
