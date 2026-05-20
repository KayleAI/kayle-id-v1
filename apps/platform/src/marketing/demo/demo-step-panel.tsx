import { cn } from "@kayle-id/ui/lib/utils";
import type { ReactNode } from "react";
import { type DemoStepId, getDemoStepSectionId } from "@/marketing/demo-hooks";

export function DemoStepPanel({
	children,
	className,
	description,
	isLocked = false,
	stepId,
	title,
}: {
	children?: ReactNode;
	className?: string;
	description?: string;
	isLocked?: boolean;
	stepId: DemoStepId;
	title?: string;
}) {
	return (
		<section
			className={cn(
				"scroll-mt-24",
				isLocked && "pointer-events-none",
				className,
			)}
			id={getDemoStepSectionId(stepId)}
		>
			{title ? (
				<h2 className="font-light text-2xl text-foreground tracking-tight">
					{title}
				</h2>
			) : null}
			{description ? (
				<p className="mb-4 mt-1 max-w-2xl text-muted-foreground text-sm leading-relaxed">
					{description}
				</p>
			) : null}
			{children}
		</section>
	);
}
