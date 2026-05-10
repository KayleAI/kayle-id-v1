import { Button } from "@kayleai/ui/button";
import { Link } from "@tanstack/react-router";
import { Fragment } from "react/jsx-runtime";
import type { FileRoutesByTo } from "@/routeTree.gen";

interface PageHeadingAction {
	label: string;
	to: keyof FileRoutesByTo;
	variant?: "default" | "outline";
}

interface PageHeadingProps {
	actions?: PageHeadingAction[];
	description?: string;
	quote?: string;
	title: string;
}

export function PageHeading({
	title,
	description,
	quote,
	actions,
}: PageHeadingProps) {
	return (
		<div className="mb-12 sm:mb-16">
			<h1 className="mx-auto max-w-[24ch] text-balance text-center font-light text-5xl text-neutral-950 tracking-tighter sm:text-6xl lg:text-7xl">
				{title}
			</h1>
			{description && (
				<p className="mx-auto mt-6 max-w-[56ch] text-balance text-center font-medium text-lg text-neutral-600 sm:mt-8 sm:text-xl lg:text-2xl">
					{description.split("\n").map((line) => (
						<Fragment key={line}>
							{line}
							<br />
						</Fragment>
					))}
				</p>
			)}
			{actions && actions.length > 0 && (
				<div className="mt-6 flex flex-col items-center justify-center gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:gap-4">
					{actions.map((action) => (
						<Button
							key={action.to}
							nativeButton={false}
							render={<Link to={action.to}>{action.label}</Link>}
							variant={action.variant ?? "default"}
						/>
					))}
				</div>
			)}
			{quote && (
				<blockquote className="mx-auto mt-10 max-w-2xl text-balance text-center font-light text-neutral-500 text-xl italic sm:mt-12 sm:text-2xl">
					“{quote}”
				</blockquote>
			)}
		</div>
	);
}
