import { Button } from "@kayle-id/ui/components/button";
import { cn } from "@kayle-id/ui/lib/utils";
import type { ReactNode } from "react";

interface DemoNoticeProps {
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	title?: string;
}

export function DemoNotice({
	action,
	children,
	className,
	title,
}: DemoNoticeProps) {
	return (
		<div
			className={cn(
				"rounded-[1rem] border border-red-200/70 bg-red-50/40 px-4 py-3 dark:border-red-900/70 dark:bg-red-950/30",
				className,
			)}
			role="alert"
		>
			<div className="flex items-start gap-3">
				<div className="mt-1.5 size-2 shrink-0 rounded-full bg-red-500/90" />
				<div className="min-w-0 flex-1">
					{title ? (
						<p className="font-medium text-red-950 text-sm dark:text-red-200">
							{title}
						</p>
					) : null}
					<div
						className={cn(
							"text-sm leading-relaxed",
							title
								? "mt-1 text-red-800/90 dark:text-red-200/90"
								: "text-red-900/90 dark:text-red-200/90",
						)}
					>
						{children}
					</div>
					{action ? <div className="mt-3">{action}</div> : null}
				</div>
			</div>
		</div>
	);
}

export function DemoErrorAlert({
	onReset,
	runError,
}: {
	onReset: () => void;
	runError: string | null;
}) {
	if (!runError) {
		return null;
	}

	return (
		<DemoNotice
			action={
				<Button onClick={onReset} type="button" variant="outline">
					Try again
				</Button>
			}
			title="Demo error"
		>
			{runError}
		</DemoNotice>
	);
}
