import { Button } from "@kayleai/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kayleai/ui/table";
import { cn } from "@kayleai/ui/utils/cn";
import { CopyIcon, EyeIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { WebhookEncryptionKey, WebhookEndpoint } from "@/app/webhooks/api";
import {
	type DeliveryTrendPoint,
	formatCount,
	getEventSubscriptionSummary,
} from "@/app/webhooks/utils";
import { RelativeTime } from "@/components/relative-time";
import { useCopyToClipboard } from "@/utils/use-copy";
import { CreateKeyDialog } from "../keys/create-dialog";
import {
	EndpointLabels,
	LoadingState,
	QueryErrorAlert,
	StatusBadge,
	showAsyncToast,
} from "../shared";

function getDeliveryChartAxisMax(trendPoints: DeliveryTrendPoint[]): number {
	const maxValue = Math.max(
		1,
		...trendPoints.map((point) => Math.max(point.total, point.failed)),
	);

	if (maxValue <= 8) {
		return maxValue;
	}

	const step = Math.ceil(maxValue / 4);
	return step * 4;
}

function getDeliveryChartTicks(axisMax: number): number[] {
	if (axisMax <= 8) {
		return Array.from({ length: axisMax + 1 }, (_, index) => index);
	}

	const step = axisMax / 4;
	return Array.from({ length: 5 }, (_, index) => Math.round(step * index));
}

function getDeliveryChartX(index: number, totalPoints: number): number {
	if (totalPoints <= 1) {
		return 50;
	}

	return (index / (totalPoints - 1)) * 100;
}

function getDeliveryChartY(value: number, axisMax: number): number {
	return 100 - (value / axisMax) * 100;
}

function getDeliveryChartPoints({
	axisMax,
	key,
	trendPoints,
}: {
	axisMax: number;
	key: "failed" | "total";
	trendPoints: DeliveryTrendPoint[];
}): string {
	return trendPoints
		.map((point, index) => {
			const x = getDeliveryChartX(index, trendPoints.length);
			const y = getDeliveryChartY(point[key], axisMax);
			return `${x},${y}`;
		})
		.join(" ");
}

const DETAIL_ROW_CLASS_NAME =
	"grid gap-2 px-4 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3";

export function EndpointPerformancePanel({
	isDeliveriesLoading,
	trendPoints,
}: {
	isDeliveriesLoading: boolean;
	trendPoints: DeliveryTrendPoint[];
}) {
	if (isDeliveriesLoading) {
		return (
			<div className="overflow-hidden rounded-md border border-border/70">
				<div className="border-border/70 border-b px-4 py-4">
					<h2 className="font-medium text-sm">Performance</h2>
				</div>
				<LoadingState minHeight="min-h-64" />
			</div>
		);
	}

	const axisMax = getDeliveryChartAxisMax(trendPoints);
	const axisTicks = getDeliveryChartTicks(axisMax);
	const totalLinePoints = getDeliveryChartPoints({
		axisMax,
		key: "total",
		trendPoints,
	});
	const failedLinePoints = getDeliveryChartPoints({
		axisMax,
		key: "failed",
		trendPoints,
	});
	const plottedTotal = trendPoints.reduce((sum, point) => sum + point.total, 0);
	const plottedFailed = trendPoints.reduce(
		(sum, point) => sum + point.failed,
		0,
	);
	const xAxisColumnCount = Math.max(trendPoints.length, 1);

	return (
		<div className="min-w-0 overflow-hidden rounded-md border border-border/70">
			<div className="space-y-5 px-4 py-5">
				<div className="space-y-3">
					<h3 className="font-medium text-sm">Event deliveries</h3>
					<div className="flex flex-wrap gap-5 text-sm">
						<div className="flex items-center gap-2">
							<span className="h-1 w-4 rotate-[-10deg] rounded-full bg-violet-500" />
							<span>Total {formatCount(plottedTotal)}</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="h-1 w-4 rotate-[-10deg] rounded-full bg-rose-500" />
							<span>Failed {formatCount(plottedFailed)}</span>
						</div>
					</div>
				</div>

				<div className="space-y-3">
					<div className="relative h-56 pr-8">
						<svg
							aria-label="Event deliveries for this endpoint this week"
							className="absolute inset-y-0 left-0 right-8 h-full w-[calc(100%-2rem)] overflow-visible"
							preserveAspectRatio="none"
							role="img"
							viewBox="0 0 100 100"
						>
							{axisTicks.map((tick) => {
								const y = getDeliveryChartY(tick, axisMax);

								return (
									<line
										className="stroke-border/80"
										key={tick}
										vectorEffect="non-scaling-stroke"
										x1="0"
										x2="100"
										y1={y}
										y2={y}
									/>
								);
							})}
							<polyline
								className="fill-none stroke-violet-500"
								points={totalLinePoints}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2.5"
								vectorEffect="non-scaling-stroke"
							/>
							<polyline
								className="fill-none stroke-rose-500"
								points={failedLinePoints}
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2.5"
								vectorEffect="non-scaling-stroke"
							/>
						</svg>

						{axisTicks.map((tick) => (
							<div
								className="-translate-y-1/2 absolute right-0 text-muted-foreground text-xs tabular-nums"
								key={tick}
								style={{ top: `${getDeliveryChartY(tick, axisMax)}%` }}
							>
								{formatCount(tick)}
							</div>
						))}
					</div>
					<div
						className="grid pr-8"
						style={{
							gridTemplateColumns: `repeat(${xAxisColumnCount}, minmax(0, 1fr))`,
						}}
					>
						{trendPoints.map((point) => (
							<div
								className="text-center text-muted-foreground text-xs tabular-nums"
								key={point.label}
							>
								{point.label}
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

export function EndpointDetailsPanel({
	action,
	endpoint,
	isSecretRevealing,
	isSecretRotating,
	onRevealSecret,
	onRotateSecret,
	secret,
}: {
	action?: ReactNode;
	endpoint: WebhookEndpoint;
	isSecretRevealing: boolean;
	isSecretRotating: boolean;
	onRevealSecret: () => Promise<void>;
	onRotateSecret: () => Promise<void>;
	secret: string | null;
}) {
	const endpointName = endpoint.name?.trim();
	const isSecretVisible = Boolean(secret);
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="min-w-0 overflow-hidden rounded-md border border-border/70">
			<div className="flex items-center justify-between gap-3 border-border/70 border-b px-4 py-3">
				<h2 className="font-medium text-sm">Destination details</h2>
				{action}
			</div>

			<dl className="divide-y divide-border/70 text-sm">
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Destination ID</dt>
					<dd className="break-all font-mono text-xs">{endpoint.id}</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Name</dt>
					<dd className="min-w-0">{endpointName || "Not set"}</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Status</dt>
					<dd className="min-w-0">
						<StatusBadge status={endpoint.enabled ? "active" : "disabled"} />
					</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Labels</dt>
					<dd className="min-w-0">
						<EndpointLabels labels={endpoint.labels} />
					</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Endpoint URL</dt>
					<dd className="break-all">{endpoint.url}</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Listening to</dt>
					<dd className="min-w-0">
						{getEventSubscriptionSummary(endpoint.subscribed_event_types)}
					</dd>
				</div>
				<div className={DETAIL_ROW_CLASS_NAME}>
					<dt className="text-muted-foreground">Replay window</dt>
					<dd className="min-w-0">
						{endpoint.undelivered_payload_retention_hours === 0
							? "Do not retain after final failure"
							: `${endpoint.undelivered_payload_retention_hours} hours after final failure`}
					</dd>
				</div>
				<div className={cn(DETAIL_ROW_CLASS_NAME, "items-center")}>
					<dt className="text-muted-foreground">Signing secret</dt>
					<dd className="min-w-0">
						<div className="flex min-h-8 min-w-0 items-center gap-2 overflow-hidden rounded-md border border-border/70 bg-muted/20 px-3 py-0.5">
							<div className="min-w-0 flex-1 truncate font-mono text-foreground/90 text-xs">
								{secret ?? `whsec_${".".repeat(32)}`}
							</div>
							<div className="flex items-center gap-1">
								{secret ? (
									<Button
										aria-label={
											copied ? "Signing secret copied" : "Copy signing secret"
										}
										onClick={() => {
											copy(secret);
										}}
										size="icon"
										type="button"
										variant="ghost"
									>
										<CopyIcon className="size-4" />
									</Button>
								) : null}
								<Button
									aria-label={
										isSecretVisible
											? "Hide signing secret"
											: "Reveal signing secret"
									}
									disabled={isSecretRevealing}
									onClick={() => {
										if (isSecretVisible) {
											void onRevealSecret();
											return;
										}

										showAsyncToast(onRevealSecret(), {
											loading: "Revealing signing secret...",
											success: "Signing secret revealed",
											error: "Failed to reveal signing secret",
										});
									}}
									size="icon"
									type="button"
									variant="ghost"
								>
									{isSecretRevealing ? (
										<Loader2Icon className="size-4 animate-spin" />
									) : (
										<EyeIcon className="size-4" />
									)}
								</Button>
								<Button
									aria-label="Rotate signing secret"
									disabled={isSecretRotating}
									onClick={() =>
										showAsyncToast(onRotateSecret(), {
											loading: "Rotating signing secret...",
											success: "Signing secret rotated",
											error: "Failed to rotate signing secret",
										})
									}
									size="icon"
									type="button"
									variant="ghost"
								>
									{isSecretRotating ? (
										<Loader2Icon className="size-4 animate-spin" />
									) : (
										<RefreshCwIcon className="size-4" />
									)}
								</Button>
							</div>
						</div>
					</dd>
				</div>
			</dl>
		</div>
	);
}

export function EndpointKeysCard({
	endpointId,
	error,
	isUpdating,
	isLoading,
	keys,
	onCreateKey,
	onDeactivateKey,
	onReactivateKey,
}: {
	endpointId: string;
	error: unknown;
	isUpdating: boolean;
	isLoading: boolean;
	keys: WebhookEncryptionKey[];
	onCreateKey: (input: {
		endpointId: string;
		jwk: JsonWebKey;
		keyId: string;
	}) => Promise<void>;
	onDeactivateKey: (keyId: string) => Promise<void>;
	onReactivateKey: (keyId: string) => Promise<void>;
}) {
	function handleToggleKey(key: WebhookEncryptionKey): void {
		const request = key.is_active
			? onDeactivateKey(key.id)
			: onReactivateKey(key.id);

		showAsyncToast(request, {
			loading: key.is_active ? "Deactivating key..." : "Re-enabling key...",
			success: key.is_active ? "Key deactivated" : "Key re-enabled",
			error: key.is_active
				? "Failed to deactivate key"
				: "Failed to re-enable key",
		});
	}

	let content: ReactNode;

	if (isLoading) {
		content = <LoadingState minHeight="min-h-24" />;
	} else if (keys.length === 0) {
		content = (
			<div className="px-4 py-5 text-muted-foreground text-sm">
				No public keys yet. Add a public key to encrypt outbound payloads for
				this destination.
			</div>
		);
	} else {
		content = (
			<div className="overflow-x-auto">
				<Table className="min-w-184 table-fixed">
					<colgroup>
						<col className="w-[38%]" />
						<col className="w-[18%]" />
						<col className="w-[14%]" />
						<col className="w-[16%]" />
						<col className="w-[14%]" />
					</colgroup>
					<TableHeader className="bg-muted/40">
						<TableRow>
							<TableHead>Public key</TableHead>
							<TableHead>Algorithm</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="text-right">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{keys.map((key) => (
							<TableRow key={key.id}>
								<TableCell className="align-middle">
									<div className="min-w-0 space-y-1">
										<div className="truncate font-medium text-sm">
											{key.key_id}
										</div>
										<div className="truncate font-mono text-muted-foreground text-xs">
											{key.id}
										</div>
									</div>
								</TableCell>
								<TableCell className="align-middle text-sm">
									{key.algorithm}
								</TableCell>
								<TableCell className="align-middle">
									<StatusBadge status={key.is_active ? "active" : "inactive"} />
								</TableCell>
								<TableCell className="align-middle text-muted-foreground text-sm tabular-nums">
									<RelativeTime iso={key.created_at} />
								</TableCell>
								<TableCell className="align-middle text-right">
									<Button
										disabled={isUpdating}
										onClick={() => handleToggleKey(key)}
										size="sm"
										type="button"
										variant="outline"
									>
										{key.is_active ? "Deactivate" : "Re-enable"}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="space-y-4">
				<QueryErrorAlert
					error={error}
					fallback="Webhook keys could not be loaded."
					title="Failed to load keys"
				/>
				{content}
			</div>
			<div className="flex justify-end border-border/70 border-t px-4 py-4">
				<CreateKeyDialog endpointId={endpointId} onSubmit={onCreateKey} />
			</div>
		</div>
	);
}
