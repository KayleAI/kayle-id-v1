import { cn } from "@kayleai/ui/utils/cn";
import { Link } from "@tanstack/react-router";

export interface SectionNavItem {
	exact?: boolean;
	label: string;
	to: string;
}

export function SectionNav({ items }: { items: SectionNavItem[] }) {
	return (
		<nav aria-label="Section navigation" className="border-border/70 border-b">
			<ul className="-mb-px flex w-full gap-5 overflow-x-auto">
				{items.map((item) => (
					<li key={item.to}>
						<Link
							activeOptions={{ exact: item.exact ?? false }}
							activeProps={{
								className: "border-foreground text-foreground",
							}}
							className={cn(
								"-mb-px flex h-10 items-center border-b-2 border-transparent px-0 pb-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
							)}
							to={item.to}
						>
							{item.label}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
