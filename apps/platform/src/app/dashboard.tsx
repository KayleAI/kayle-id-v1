import { Alert, AlertDescription, AlertTitle } from "@kayleai/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@kayleai/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@kayleai/ui/empty";
import { Skeleton } from "@kayleai/ui/skeleton";
import { cn } from "@kayleai/ui/utils/cn";
import { useQuery } from "@tanstack/react-query";
import { BarChart3Icon } from "lucide-react";
import { useState } from "react";
import { AppHeading } from "@/components/app-heading";
import {
  getSessionAnalyticsOverview,
  type SessionAnalyticsTimelinePoint,
  type SessionAnalyticsTrendPoint,
} from "./dashboard/api";

type MetricKey = Exclude<keyof SessionAnalyticsTimelinePoint, "date">;

type BreakdownMetricKey = Exclude<MetricKey, "active" | "total">;

type DisplayMetricKey = BreakdownMetricKey | "total";

type PeriodSummary = Pick<
  SessionAnalyticsTimelinePoint,
  "total" | BreakdownMetricKey
>;

type MetricConfig = {
  description: string;
  dotClassName: string;
  label: string;
  stroke: string;
  title: string;
};

type ChartPoint = {
  x: number;
  y: number;
};

type InteractiveChartSurfaceProps = {
  activeIndex: number;
  ariaLabel: string;
  children: React.ReactNode;
  className?: string;
  data: SessionAnalyticsTrendPoint[];
  isInspecting: boolean;
  onActiveIndexChange: (index: number) => void;
  onInteractionEnd: () => void;
};

type SummaryBreakdownCardProps = {
  activeMetric: BreakdownMetricKey | null;
  className?: string;
  onActiveMetricChange: (metric: BreakdownMetricKey | null) => void;
  summary: PeriodSummary;
};

type MetricTrendCardProps = {
  activeIndex: number;
  data: SessionAnalyticsTrendPoint[];
  isInspecting: boolean;
  metric: BreakdownMetricKey;
  onActiveIndexChange: (index: number) => void;
  onInteractionEnd: () => void;
};

const DASHBOARD_SKELETON_CARD_KEYS = [
  "summary",
  "success",
  "failure",
  "expired",
  "cancelled",
] as const;

const BREAKDOWN_METRICS: BreakdownMetricKey[] = [
  "success",
  "failure",
  "expired",
  "cancelled",
];

const ANALYTICS_CARD_CLASS =
  "overflow-hidden rounded-2xl border border-border/70 bg-background shadow-none";
const CHART_ACCENT_STROKE = "#635bff";
const CHART_VIEWBOX_WIDTH = 336;
const CHART_VIEWBOX_HEIGHT = 184;
const CHART_PLOT_TOP = 16;
const CHART_PLOT_RIGHT = 314;
const CHART_PLOT_BOTTOM = 32;
const CHART_PLOT_LEFT = 12;
const CHART_Y_AXIS_LABEL_X = CHART_VIEWBOX_WIDTH - 6;

const METRIC_CONFIG: Record<DisplayMetricKey, MetricConfig> = {
  total: {
    description: "All verification sessions created for your organization.",
    dotClassName: "bg-[#635bff]",
    label: "Total Sessions",
    stroke: "#635bff",
    title: "Total sessions",
  },
  success: {
    description: "Sessions where at least one verification attempt succeeded.",
    dotClassName: "bg-[#10b981]",
    label: "Successful",
    stroke: "#10b981",
    title: "Successful sessions",
  },
  failure: {
    description: "Completed sessions with no successful attempts.",
    dotClassName: "bg-[#f43f5e]",
    label: "Failed",
    stroke: "#f43f5e",
    title: "Failed sessions",
  },
  expired: {
    description:
      "Sessions that aged out before they reached a successful outcome.",
    dotClassName: "bg-[#f59e0b]",
    label: "Expired",
    stroke: "#f59e0b",
    title: "Expired sessions",
  },
  cancelled: {
    description: "Sessions that were actively cancelled before completion.",
    dotClassName: "bg-slate-400",
    label: "Cancelled",
    stroke: "#94a3b8",
    title: "Cancelled sessions",
  },
};

function formatMetric(value: number): string {
  return value.toLocaleString();
}

function formatTrendTick(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTrendTooltipLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTrendPeriodLabel(dayCount: number): string {
  if (dayCount <= 0) {
    return "No analytics yet";
  }

  return `Last ${dayCount} day${dayCount === 1 ? "" : "s"}`;
}

function createEmptyPeriodSummary(): PeriodSummary {
  return {
    cancelled: 0,
    expired: 0,
    failure: 0,
    success: 0,
    total: 0,
  };
}

function clampIndex(index: number, count: number): number {
  if (count <= 1) {
    return 0;
  }

  return Math.max(0, Math.min(count - 1, index));
}

function resolveIndexFromClientX(
  clientX: number,
  rect: DOMRect,
  count: number
): number {
  if (count <= 1) {
    return 0;
  }

  const chartLeft = (CHART_PLOT_LEFT / CHART_VIEWBOX_WIDTH) * rect.width;
  const chartRight = (CHART_PLOT_RIGHT / CHART_VIEWBOX_WIDTH) * rect.width;
  const clampedX = Math.max(
    chartLeft,
    Math.min(chartRight, clientX - rect.left)
  );
  const ratio =
    chartRight === chartLeft
      ? 0
      : (clampedX - chartLeft) / (chartRight - chartLeft);
  return clampIndex(Math.round(ratio * (count - 1)), count);
}

function buildChartPoints({
  bottom,
  data,
  height,
  left,
  metric,
  right,
  top,
}: {
  bottom: number;
  data: SessionAnalyticsTrendPoint[];
  height: number;
  left: number;
  metric: BreakdownMetricKey;
  right: number;
  top: number;
}): ChartPoint[] {
  const maxValue = Math.max(1, ...data.map((point) => point[metric]));
  const innerHeight = height - top - bottom;
  const innerWidth = right - left;

  return data.map((point, index) => {
    const x =
      data.length === 1
        ? left
        : left + (innerWidth * index) / (data.length - 1);
    const y = top + innerHeight - (point[metric] / maxValue) * innerHeight;

    return {
      x,
      y,
    };
  });
}

function buildLinePath(points: ChartPoint[]): string {
  if (points.length === 0) {
    return "";
  }

  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    )
    .join(" ");
}

function getMetricChartTicks(maxValue: number): number[] {
  if (maxValue <= 1) {
    return [1, 0];
  }

  return [maxValue, Math.round(maxValue / 2), 0];
}

function getMetricPeriodTotal(
  data: SessionAnalyticsTrendPoint[],
  metric: BreakdownMetricKey
): number {
  let total = 0;

  for (const point of data) {
    total += point[metric];
  }

  return total;
}

function getPeriodSummary(
  timeline: SessionAnalyticsTimelinePoint[]
): PeriodSummary {
  const latestPoint = timeline.at(-1);

  if (!latestPoint) {
    return createEmptyPeriodSummary();
  }

  return {
    cancelled: latestPoint.cancelled,
    expired: latestPoint.expired,
    failure: latestPoint.failure,
    success: latestPoint.success,
    total: latestPoint.total,
  };
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {DASHBOARD_SKELETON_CARD_KEYS.map((key) => (
        <Card className={ANALYTICS_CARD_CLASS} key={key}>
          <CardHeader className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9 w-24" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-36 w-full rounded-xl" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function InteractiveChartSurface({
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
        className
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
            data.length
          )
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
            data.length
          )
        );
      }}
      role="slider"
      tabIndex={0}
    >
      {children}
    </div>
  );
}

function SummaryBreakdownCard({
  activeMetric,
  className,
  onActiveMetricChange,
  summary,
}: SummaryBreakdownCardProps) {
  const total = Math.max(summary.total, 1);

  return (
    <Card className={cn(ANALYTICS_CARD_CLASS, className)}>
      <CardHeader className="space-y-2">
        <CardDescription className="font-medium text-foreground text-sm">
          Sessions in last 14 days
        </CardDescription>
        <CardTitle className="text-4xl tracking-tight">
          {formatMetric(summary.total)}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-5">
        <div
          className="overflow-hidden rounded-full bg-muted/30"
          onPointerLeave={() => {
            onActiveMetricChange(null);
          }}
        >
          <div className="flex h-4 w-full">
            {BREAKDOWN_METRICS.map((metric) => {
              const width =
                summary[metric] === 0 ? 0 : (summary[metric] / total) * 100;

              return (
                <div
                  className={cn(
                    "h-full transition-opacity",
                    activeMetric === null || activeMetric === metric
                      ? "opacity-100"
                      : "opacity-80"
                  )}
                  key={metric}
                  onPointerEnter={() => {
                    onActiveMetricChange(metric);
                  }}
                  style={{
                    backgroundColor: METRIC_CONFIG[metric].stroke,
                    width: `${width}%`,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div
          className="space-y-1"
          onPointerLeave={() => {
            onActiveMetricChange(null);
          }}
        >
          {BREAKDOWN_METRICS.map((metric) => {
            const config = METRIC_CONFIG[metric];
            const isActive = activeMetric === metric;

            return (
              <div
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors",
                  isActive ? "bg-muted/35" : "hover:bg-muted/20"
                )}
                key={metric}
                onPointerEnter={() => {
                  onActiveMetricChange(metric);
                }}
              >
                <span className="flex items-center gap-2 text-foreground">
                  <span
                    className={cn("size-2.5 rounded-full", config.dotClassName)}
                  />
                  <span>{config.label}</span>
                </span>
                <span className="font-medium text-foreground tabular-nums">
                  {formatMetric(summary[metric])}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricTrendCard({
  activeIndex,
  data,
  isInspecting,
  metric,
  onActiveIndexChange,
  onInteractionEnd,
}: MetricTrendCardProps) {
  const config = METRIC_CONFIG[metric];
  const selectedPoint = data[activeIndex];
  const periodTotal = getMetricPeriodTotal(data, metric);
  const width = CHART_VIEWBOX_WIDTH;
  const height = CHART_VIEWBOX_HEIGHT;
  const top = CHART_PLOT_TOP;
  const right = CHART_PLOT_RIGHT;
  const bottom = CHART_PLOT_BOTTOM;
  const left = CHART_PLOT_LEFT;
  const baselineY = height - bottom;
  const points = buildChartPoints({
    bottom,
    data,
    height,
    left,
    metric,
    right,
    top,
  });
  const selectedChartPoint = points[activeIndex];
  const maxValue = Math.max(1, ...data.map((point) => point[metric]));
  const yAxisTicks = getMetricChartTicks(maxValue);
  const activeX =
    data.length <= 1
      ? left
      : left + ((right - left) * activeIndex) / (data.length - 1);
  const selectedDateLabel =
    isInspecting && selectedPoint
      ? formatTrendTooltipLabel(selectedPoint.date)
      : formatTrendPeriodLabel(data.length);
  const displayedValue =
    isInspecting && selectedPoint ? selectedPoint[metric] : periodTotal;

  return (
    <Card className={ANALYTICS_CARD_CLASS}>
      <CardHeader className="space-y-1">
        <CardDescription className="font-medium text-foreground text-sm">
          {config.title}
        </CardDescription>
        <CardTitle className="text-4xl tracking-tight">
          {formatMetric(displayedValue)}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{selectedDateLabel}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        <InteractiveChartSurface
          activeIndex={activeIndex}
          ariaLabel={`${config.title} chart. Use left and right arrow keys to inspect each day.`}
          className="overflow-hidden rounded-xl border border-border/70 bg-background px-2 py-2"
          data={data}
          isInspecting={isInspecting}
          onActiveIndexChange={onActiveIndexChange}
          onInteractionEnd={onInteractionEnd}
        >
          <svg
            aria-hidden="true"
            className="h-48 w-full"
            focusable="false"
            preserveAspectRatio="none"
            viewBox={`0 0 ${width} ${height}`}
          >
            {yAxisTicks.map((tick) => {
              const y =
                top + ((maxValue - tick) / maxValue) * (baselineY - top);

              return (
                <g key={`grid-${metric}-${tick}`}>
                  <line
                    stroke="rgba(148, 163, 184, 0.16)"
                    x1={left}
                    x2={right}
                    y1={y}
                    y2={y}
                  />
                  <text
                    fill="rgba(100, 116, 139, 0.92)"
                    fontSize="11"
                    textAnchor="end"
                    x={CHART_Y_AXIS_LABEL_X}
                    y={y + 4}
                  >
                    {formatMetric(tick)}
                  </text>
                </g>
              );
            })}

            <path
              d={buildLinePath(points)}
              fill="none"
              stroke={CHART_ACCENT_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2.2"
            />

            {isInspecting && selectedChartPoint ? (
              <>
                <line
                  stroke="rgba(99, 91, 255, 0.16)"
                  strokeDasharray="4 6"
                  x1={activeX}
                  x2={activeX}
                  y1={top}
                  y2={baselineY}
                />
                <circle
                  cx={selectedChartPoint.x}
                  cy={selectedChartPoint.y}
                  fill="white"
                  r="4.25"
                  stroke={CHART_ACCENT_STROKE}
                  strokeWidth="2"
                />
              </>
            ) : null}

            <text
              fill="rgba(100, 116, 139, 0.92)"
              fontSize="11"
              textAnchor="start"
              x={left}
              y={height - 10}
            >
              {data[0] ? formatTrendTick(data[0].date) : ""}
            </text>
            <text
              fill="rgba(100, 116, 139, 0.92)"
              fontSize="11"
              textAnchor="end"
              x={right}
              y={height - 10}
            >
              {data.at(-1) ? formatTrendTick(data.at(-1)?.date ?? "") : ""}
            </text>
          </svg>
        </InteractiveChartSurface>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const analyticsQuery = useQuery({
    queryFn: getSessionAnalyticsOverview,
    queryKey: ["dashboard", "session-analytics"],
    staleTime: 60_000,
  });
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [activeBreakdownMetric, setActiveBreakdownMetric] =
    useState<BreakdownMetricKey | null>(null);

  const trend = analyticsQuery.data?.trend ?? [];
  const timeline = analyticsQuery.data?.timeline ?? [];
  const matchedActiveIndex = trend.findIndex(
    (point) => point.date === activeDate
  );
  const periodSummary = getPeriodSummary(timeline);
  const isInspecting = matchedActiveIndex >= 0;
  const activeIndex = isInspecting
    ? matchedActiveIndex
    : Math.max(trend.length - 1, 0);
  const isEmpty = analyticsQuery.data?.summary.total === 0;
  const shouldShowError = analyticsQuery.isError;
  const shouldShowGrid = (analyticsQuery.data?.summary.total ?? 0) > 0;
  const shouldShowLoading = analyticsQuery.isLoading && !analyticsQuery.data;

  function handleActiveIndexChange(index: number): void {
    const point = trend[clampIndex(index, trend.length)];

    if (!point) {
      return;
    }

    setActiveDate(point.date);
  }

  function handleInteractionEnd(): void {
    setActiveDate(null);
  }

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-1 grow flex-col">
      <AppHeading
        description="Your organisation's dashboard for Kayle ID."
        title="Dashboard"
      />
      <hr className="my-8" />

      {shouldShowLoading ? <DashboardSkeleton /> : null}

      {shouldShowError ? (
        <Alert variant="destructive">
          <AlertTitle>Failed to load analytics</AlertTitle>
          <AlertDescription>
            {analyticsQuery.error instanceof Error
              ? analyticsQuery.error.message
              : "Something went wrong while loading dashboard analytics."}
          </AlertDescription>
        </Alert>
      ) : null}

      {isEmpty ? (
        <Empty className="border border-border/70 bg-muted/20">
          <EmptyMedia className="border border-border/70 bg-background">
            <BarChart3Icon className="size-5 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>No analytics yet</EmptyTitle>
            <EmptyDescription>
              Session analytics will appear here once your organization starts
              creating verification sessions.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {shouldShowGrid ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <SummaryBreakdownCard
            activeMetric={activeBreakdownMetric}
            className="md:col-span-2"
            onActiveMetricChange={setActiveBreakdownMetric}
            summary={periodSummary}
          />

          {BREAKDOWN_METRICS.map((metric) => (
            <MetricTrendCard
              activeIndex={activeIndex}
              data={trend}
              isInspecting={isInspecting}
              key={metric}
              metric={metric}
              onActiveIndexChange={handleActiveIndexChange}
              onInteractionEnd={handleInteractionEnd}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
