import { Button } from "@kayleai/ui/button";
import {
	CopyIcon,
	EyeIcon,
	KeyRoundIcon,
	Loader2Icon,
	RefreshCwIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { WebhookEncryptionKey, WebhookEndpoint } from "@/app/webhooks/api";
import {
	type DeliveryTrendPoint,
	type EndpointDeliveryStats,
	formatCount,
	getEndpointDisplayName,
	getEventSubscriptionSummary,
} from "@/app/webhooks/utils";
import { formatDate } from "@/utils/format-date";
import { useCopyToClipboard } from "@/utils/use-copy";
import { CreateKeyDialog } from "../keys/create-dialog";
import {
	LoadingState,
	QueryErrorAlert,
	ResponseCodeBadge,
	StatusBadge,
	showAsyncToast,
} from "../shared";

export function EndpointPerformancePanel({
	endpointDeliveryStats,
	isDeliveriesLoading,
	trendPoints,
}: {
	endpointDeliveryStats: EndpointDeliveryStats;
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

	const maxValue = Math.max(
		1,
		...trendPoints.map((point) => Math.max(point.total, point.failed)),
	);
	const succeededCount = Math.max(
		endpointDeliveryStats.total -
			endpointDeliveryStats.failed -
			endpointDeliveryStats.inFlight,
		0,
	);

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="flex items-start justify-between gap-4 border-border/70 border-b px-4 py-4">
				<div className="space-y-1">
					<h2 className="font-medium text-sm">Performance</h2>
					<p className="text-muted-foreground text-sm">
						Delivery activity over the last 7 days.
					</p>
				</div>
				<span className="text-muted-foreground text-xs uppercase tracking-[0.14em]">
					Last 7 days
				</span>
			</div>

			<div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_18rem]">
				<div className="space-y-4 border-border/70 p-4 xl:border-r">
					<div className="flex flex-wrap gap-4 text-xs">
						<div className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-foreground/35" />
							Total
						</div>
						<div className="flex items-center gap-2">
							<span className="size-2 rounded-full bg-red-500/40" />
							Failed
						</div>
					</div>

					<div className="flex h-44 items-end gap-3">
						{trendPoints.map((point) => (
							<div
								className="flex min-w-0 flex-1 flex-col items-center gap-2"
								key={point.label}
							>
								<div className="flex h-32 w-full items-end justify-center gap-1">
									<div
										className="w-full max-w-3 rounded-sm bg-foreground/15"
										style={{
											height:
												point.total > 0
													? `${Math.max((point.total / maxValue) * 100, 8)}%`
													: "0%",
										}}
									/>
									<div
										className="w-full max-w-3 rounded-sm bg-red-500/30"
										style={{
											height:
												point.failed > 0
													? `${Math.max((point.failed / maxValue) * 100, 8)}%`
													: "0%",
										}}
									/>
								</div>
								<div className="text-[11px] text-muted-foreground tabular-nums">
									{point.label}
								</div>
							</div>
						))}
					</div>
				</div>

				<div className="space-y-4 px-4 py-4">
					<h3 className="font-medium text-sm">Delivery overview</h3>
					<dl className="space-y-3 text-sm">
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Total deliveries</dt>
							<dd className="font-medium tabular-nums">
								{formatCount(endpointDeliveryStats.total)}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Succeeded</dt>
							<dd className="font-medium tabular-nums">
								{formatCount(succeededCount)}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Failed</dt>
							<dd className="font-medium tabular-nums">
								{formatCount(endpointDeliveryStats.failed)}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">In flight</dt>
							<dd className="font-medium tabular-nums">
								{formatCount(endpointDeliveryStats.inFlight)}
							</dd>
						</div>
						<div className="flex items-center justify-between gap-4">
							<dt className="text-muted-foreground">Last response</dt>
							<dd>
								<ResponseCodeBadge
									statusCode={endpointDeliveryStats.lastStatusCode}
								/>
							</dd>
						</div>
					</dl>
				</div>
			</div>
		</div>
	);
}

export function EndpointDetailsPanel({
	endpoint,
}: {
	endpoint: WebhookEndpoint;
}) {
	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="border-border/70 border-b px-4 py-3">
				<h2 className="font-medium text-sm">Destination details</h2>
			</div>

			<dl className="divide-y divide-border/70 text-sm">
				<div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
					<dt className="text-muted-foreground">Destination ID</dt>
					<dd className="break-all font-mono text-xs">{endpoint.id}</dd>
				</div>
				<div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
					<dt className="text-muted-foreground">Name</dt>
					<dd className="min-w-0">{getEndpointDisplayName(endpoint)}</dd>
				</div>
				<div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
					<dt className="text-muted-foreground">Endpoint URL</dt>
					<dd className="break-all">{endpoint.url}</dd>
				</div>
				<div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
					<dt className="text-muted-foreground">Listening to</dt>
					<dd className="min-w-0">
						{getEventSubscriptionSummary(endpoint.subscribed_event_types)}
					</dd>
				</div>
			</dl>
		</div>
	);
}

export function EndpointSigningSecretCard({
	secret,
	isRevealing,
	isRotating,
	onRevealSecret,
	onRotateSecret,
}: {
	secret: string | null;
	isRevealing: boolean;
	isRotating: boolean;
	onRevealSecret: () => Promise<void>;
	onRotateSecret: () => Promise<void>;
}) {
	const isSecretVisible = Boolean(secret);
	const { copied, copy } = useCopyToClipboard();

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="space-y-4 px-4 py-4">
				<div className="space-y-2">
					<div className="flex items-center gap-2 font-medium text-sm">
						<KeyRoundIcon className="size-4 text-muted-foreground" />
						Signing secret
					</div>
					<p className="text-muted-foreground text-sm leading-6">
						Use this secret to verify that deliveries came from Kayle ID. Reveal
						it temporarily or rotate it if you need to replace it.
					</p>
				</div>

				<div className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-4 py-3">
					<div className="min-w-0 flex-1 truncate font-mono text-foreground/90 text-sm">
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
							disabled={isRevealing}
							onClick={() => {
								if (isSecretVisible) {
									onRevealSecret();
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
							{isRevealing ? (
								<Loader2Icon className="size-4 animate-spin" />
							) : (
								<EyeIcon className="size-4" />
							)}
						</Button>
						<Button
							aria-label="Rotate signing secret"
							disabled={isRotating}
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
							{isRotating ? (
								<Loader2Icon className="size-4 animate-spin" />
							) : (
								<RefreshCwIcon className="size-4" />
							)}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

export function EndpointResourcesCard() {
	const resources = [
		{
			href: "https://kayle.id/docs/api/webhooks/endpoints#get-by-id",
			label: "Endpoint API reference",
		},
		{
			href: "https://kayle.id/docs/api/webhooks/endpoints#rotate-signing-secret",
			label: "Signing secret reference",
		},
		{
			href: "https://kayle.id/docs/api/webhooks/deliveries#retry",
			label: "Delivery retry reference",
		},
	] as const;

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="border-border/70 border-b px-4 py-4">
				<h2 className="font-medium text-sm">Resources</h2>
			</div>

			<div className="space-y-3 px-4 py-4 text-sm">
				{resources.map((resource) => (
					<a
						className="block text-foreground transition-colors hover:text-foreground/70 hover:underline"
						href={resource.href}
						key={resource.href}
						rel="noopener"
						target="_blank"
					>
						{resource.label}
					</a>
				))}
			</div>
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
			<div className="divide-y divide-border/70">
				{keys.map((key) => (
					<div className="space-y-3 px-4 py-4" key={key.id}>
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<div className="truncate font-medium text-sm">{key.key_id}</div>
								<div className="truncate font-mono text-muted-foreground text-xs">
									{key.algorithm} · {key.id}
								</div>
							</div>
							<StatusBadge status={key.is_active ? "active" : "inactive"} />
						</div>

						<div className="flex items-center justify-between gap-3">
							<p className="text-muted-foreground text-xs tabular-nums">
								{formatDate(key.created_at)}
							</p>
							<Button
								disabled={isUpdating}
								onClick={() => handleToggleKey(key)}
								size="sm"
								type="button"
								variant="outline"
							>
								{key.is_active ? "Deactivate" : "Re-enable"}
							</Button>
						</div>
					</div>
				))}
			</div>
		);
	}

	return (
		<div className="overflow-hidden rounded-md border border-border/70">
			<div className="flex items-start justify-between gap-3 border-border/70 border-b px-4 py-4">
				<div className="space-y-1">
					<h2 className="font-medium text-sm">Public keys</h2>
				</div>
				<CreateKeyDialog endpointId={endpointId} onSubmit={onCreateKey} />
			</div>
			<div className="space-y-4">
				<QueryErrorAlert
					error={error}
					fallback="Webhook keys could not be loaded."
					title="Failed to load keys"
				/>
				{content}
			</div>
		</div>
	);
}
