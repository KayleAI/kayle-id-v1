import { Tooltip, TooltipContent, TooltipTrigger } from "@kayleai/ui/tooltip";
import type { ComponentProps, MouseEventHandler } from "react";
import { useMemo } from "react";
import {
	buildTooltipParts,
	formatAbsolute,
	formatRelative,
} from "@/utils/timestamp";

type TooltipSide = ComponentProps<typeof TooltipContent>["side"];

interface RelativeTimeProps {
	className?: string;
	/**
	 * `auto` (default) — compact relative label ("5m ago", "in 3 days") in
	 * the trigger; full tooltip on hover.
	 * `absolute` — full date/time as the trigger label, same tooltip. Useful
	 * when a designer wants the literal date in-line but still wants UTC +
	 * local on hover.
	 */
	format?: "absolute" | "auto";
	/** ISO 8601 timestamp. */
	iso: string;
	/**
	 * Stop the click on the trigger from bubbling. Useful when the timestamp
	 * sits inside a row that has its own click handler (e.g. expandable
	 * audit-log rows).
	 */
	onClick?: MouseEventHandler<HTMLSpanElement>;
	side?: TooltipSide;
}

/**
 * Renders a timestamp as a compact label with a hover tooltip showing the
 * full UTC + local timezone breakdown. The tooltip is themed against
 * `bg-popover` so it tracks the active light/dark theme, instead of the
 * upstream `bg-foreground` inverted style which clashes with light mode.
 */
export function RelativeTime({
	className,
	format = "auto",
	iso,
	onClick,
	side = "top",
}: RelativeTimeProps) {
	// `now` is fixed per render so the trigger label and the tooltip header
	// can't disagree by a tick. We don't bother re-rendering on a timer
	// because audit-log rows are usually short-lived in the viewport; if a
	// caller needs live updates they can lift `now` themselves.
	const { label, tooltip } = useMemo(() => {
		const now = new Date();
		return {
			label:
				format === "absolute" ? formatAbsolute(iso) : formatRelative(iso, now),
			tooltip: buildTooltipParts(iso, now),
		};
	}, [format, iso]);

	return (
		<Tooltip>
			<TooltipTrigger
				className={className}
				onClick={onClick}
				render={<span>{label}</span>}
			/>
			<TooltipContent
				className="min-w-[260px] border border-border bg-popover p-3 text-left text-popover-foreground shadow-md ring-1 ring-foreground/5 [&>.rotate-45]:border [&>.rotate-45]:border-border [&>.rotate-45]:bg-popover [&>.rotate-45]:fill-popover"
				side={side}
			>
				<div className="font-medium text-foreground text-sm">
					{tooltip.duration}
				</div>
				<dl className="mt-2 grid items-baseline gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr_auto]">
					<dt className="font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
						UTC
					</dt>
					<dd className="text-muted-foreground">{tooltip.utcDate}</dd>
					<dd className="text-right text-muted-foreground tabular-nums">
						{tooltip.utcTime}
					</dd>
					<dt className="font-medium font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
						{tooltip.localTimezone}
					</dt>
					<dd className="text-muted-foreground">{tooltip.localDate}</dd>
					<dd className="text-right text-muted-foreground tabular-nums">
						{tooltip.localTime}
					</dd>
				</dl>
			</TooltipContent>
		</Tooltip>
	);
}
