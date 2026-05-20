import OctagonCheck from "@kayle-id/ui/icons/octagon-check";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import type { ReactNode } from "react";

type CalloutTone = "emerald" | "amber" | "red";

type StatusCalloutProps = {
	tone: CalloutTone;
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
};

const TONE_STYLES: Record<
	CalloutTone,
	{ container: string; title: string; description: string }
> = {
	emerald: {
		container:
			"border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/40",
		title: "text-emerald-800 dark:text-emerald-200",
		description: "text-emerald-700 dark:text-emerald-300",
	},
	amber: {
		container:
			"border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/40",
		title: "text-amber-800 dark:text-amber-200",
		description: "text-amber-700 dark:text-amber-300",
	},
	red: {
		container:
			"border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/40",
		title: "text-red-800 dark:text-red-200",
		description: "text-red-700 dark:text-red-300",
	},
};

const TONE_ICONS: Record<
	CalloutTone,
	{ Icon: typeof OctagonCheck; className: string }
> = {
	emerald: {
		Icon: OctagonCheck,
		className: "text-emerald-700 dark:text-emerald-400",
	},
	amber: { Icon: OctagonWarning, className: "text-amber-500" },
	red: { Icon: OctagonWarning, className: "text-red-500" },
};

export function StatusCallout({
	tone,
	title,
	description,
	children,
}: StatusCalloutProps) {
	const styles = TONE_STYLES[tone];
	const { Icon, className: iconClassName } = TONE_ICONS[tone];

	return (
		<div
			className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${styles.container}`}
		>
			<Icon
				aria-hidden="true"
				className={`mt-0.5 size-5 shrink-0 ${iconClassName}`}
			/>
			<div className="min-w-0 flex-1">
				<p className={`font-medium text-sm ${styles.title}`}>{title}</p>
				{description ? (
					<p className={`mt-1 text-sm text-pretty ${styles.description}`}>
						{description}
					</p>
				) : null}
				{children}
			</div>
		</div>
	);
}

export function StatusCalloutSubtext({
	tone,
	children,
}: {
	tone: CalloutTone;
	children: ReactNode;
}) {
	return (
		<p className={`mt-1 text-sm ${TONE_STYLES[tone].description}`}>
			{children}
		</p>
	);
}
