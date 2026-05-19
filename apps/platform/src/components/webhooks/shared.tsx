import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import { Badge } from "@kayleai/ui/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kayleai/ui/empty";
import { cn } from "@kayleai/ui/utils/cn";
import { Loader2Icon, WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import type { DeliveryStatus } from "@/app/webhooks/api";
import {
	getResponseCodeClass,
	getStatusBadgeClass,
} from "@/app/webhooks/utils";

export function StatusBadge({
	className,
	status,
}: {
	className?: string;
	status: DeliveryStatus | "active" | "disabled" | "inactive";
}) {
	return (
		<Badge
			className={cn(
				"px-2.5 py-1 text-xs capitalize",
				getStatusBadgeClass(status),
				className,
			)}
			variant="outline"
		>
			{status.replace("_", " ")}
		</Badge>
	);
}

export function EndpointLabels({ labels }: { labels: string[] }) {
	if (labels.length === 0) {
		return <span className="text-muted-foreground text-xs">No labels</span>;
	}

	return (
		<div className="flex flex-wrap gap-1.5">
			{labels.map((label) => (
				<Badge
					className="border-border bg-muted/40 px-2 py-0.5 font-normal text-muted-foreground text-xs"
					key={label}
					variant="outline"
				>
					{label}
				</Badge>
			))}
		</div>
	);
}

export function SectionMessage({
	description,
	title,
}: {
	description: string;
	title: string;
}) {
	return (
		<Empty className="min-h-56 rounded-md border border-border/80 border-dashed bg-muted/10">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<WebhookIcon className="size-5" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export interface AsyncToastMessages {
	error: string;
	loading: string;
	success: string;
}

export function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

export function showAsyncToast(
	promise: Promise<void>,
	messages: AsyncToastMessages,
): void {
	toast.promise(promise, {
		loading: messages.loading,
		success: messages.success,
		error: (error) => getErrorMessage(error, messages.error),
	});
}

export function QueryErrorAlert({
	error,
	fallback,
	title,
}: {
	error: unknown;
	fallback: string;
	title: string;
}) {
	if (!error) {
		return null;
	}

	return (
		<Alert variant="destructive">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{getErrorMessage(error, fallback)}</AlertDescription>
		</Alert>
	);
}

export function LoadingState({
	minHeight = "min-h-56",
}: {
	minHeight?: string;
}) {
	return (
		<div className={cn("flex items-center justify-center", minHeight)}>
			<Loader2Icon className="size-5 animate-spin text-muted-foreground" />
		</div>
	);
}

export function ResponseCodeBadge({
	statusCode,
}: {
	statusCode: number | null;
}) {
	return (
		<Badge
			className={cn(
				"px-2.5 py-1 font-mono text-xs",
				getResponseCodeClass(statusCode),
			)}
			variant="outline"
		>
			{statusCode ?? "n/a"}
		</Badge>
	);
}
