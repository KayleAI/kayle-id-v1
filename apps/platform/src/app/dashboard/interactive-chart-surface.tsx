import { cn } from "@kayle-id/ui/lib/utils";
import {
	clampIndex,
	formatTrendPeriodLabel,
	formatTrendTooltipLabel,
	resolveIndexFromClientX,
} from "./chart-utils";
import type { InteractiveChartSurfaceProps } from "./types";

export function InteractiveChartSurface({
	activeIndex,
	ariaLabel,
	children,
	className,
	data,
	isInspecting,
	onActiveIndexChange,
	onInteractionEnd,
}: InteractiveChartSurfaceProps) {
	let ariaValueText = formatTrendPeriodLabel(data.length);

	if (isInspecting) {
		ariaValueText = data[activeIndex]
			? formatTrendTooltipLabel(data[activeIndex].date)
			: "No data";
	}

	return (
		<div
			aria-label={ariaLabel}
			aria-valuemax={Math.max(data.length, 1)}
			aria-valuemin={1}
			aria-valuenow={Math.min(activeIndex + 1, Math.max(data.length, 1))}
			aria-valuetext={ariaValueText}
			className={cn(
				"relative touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
				className,
			)}
			onBlur={() => {
				onInteractionEnd();
			}}
			onKeyDown={(event) => {
				if (event.key === "ArrowLeft") {
					event.preventDefault();
					onActiveIndexChange(clampIndex(activeIndex - 1, data.length));
					return;
				}

				if (event.key === "ArrowRight") {
					event.preventDefault();
					onActiveIndexChange(clampIndex(activeIndex + 1, data.length));
					return;
				}

				if (event.key === "Home") {
					event.preventDefault();
					onActiveIndexChange(0);
					return;
				}

				if (event.key === "End") {
					event.preventDefault();
					onActiveIndexChange(Math.max(data.length - 1, 0));
					return;
				}

				if (event.key === "Escape") {
					event.preventDefault();
					onInteractionEnd();
				}
			}}
			onPointerCancel={() => {
				onInteractionEnd();
			}}
			onPointerDown={(event) => {
				onActiveIndexChange(
					resolveIndexFromClientX(
						event.clientX,
						event.currentTarget.getBoundingClientRect(),
						data.length,
					),
				);
			}}
			onPointerLeave={() => {
				onInteractionEnd();
			}}
			onPointerMove={(event) => {
				onActiveIndexChange(
					resolveIndexFromClientX(
						event.clientX,
						event.currentTarget.getBoundingClientRect(),
						data.length,
					),
				);
			}}
			role="slider"
			tabIndex={0}
		>
			{children}
		</div>
	);
}
