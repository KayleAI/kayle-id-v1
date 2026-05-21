import { cn } from "@kayle-id/ui/lib/utils";

export function AppHeading({
	title,
	description,
	button,
	className,
}: {
	title: string;
	description?: string;
	button?: React.ReactNode;
	className?: string;
}) {
	return (
		<div className="flex flex-row flex-wrap items-center justify-between gap-3 sm:gap-x-6">
			<div className={cn("flex min-w-0 flex-1 flex-col", className)}>
				<h1 className="mb-1 font-light text-3xl text-foreground tracking-tight">
					{title}
				</h1>
				{description ? (
					<p className="text-lg text-muted-foreground">{description}</p>
				) : null}
			</div>
			{button ? (
				<div className="flex shrink-0 justify-end">{button}</div>
			) : null}
		</div>
	);
}
