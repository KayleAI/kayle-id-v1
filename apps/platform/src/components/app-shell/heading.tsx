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
		<div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-x-6">
			<div className={cn("flex min-w-0 flex-col md:flex-1", className)}>
				<h1 className="mb-1 font-light text-3xl text-foreground tracking-tight">
					{title}
				</h1>
				{description ? (
					<p className="text-lg text-muted-foreground">{description}</p>
				) : null}
			</div>
			{button ? (
				<div className="flex shrink-0 md:justify-end">{button}</div>
			) : null}
		</div>
	);
}
