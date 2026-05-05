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
			<div className="max-w-3xl">
				<h1 className="mb-5 text-balance font-light text-5xl text-neutral-950 tracking-tighter sm:mb-6 sm:text-6xl lg:text-7xl">
					{title}
				</h1>
				{description && (
					<p className="mb-8 text-balance font-medium text-lg text-neutral-600 sm:mb-10 sm:text-xl lg:mb-12 lg:text-2xl">
						{description.split("\n").map((line) => (
							<Fragment key={line}>
								{line}
								<br />
							</Fragment>
						))}
					</p>
				)}
				{actions && actions.length > 0 && (
					<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-4">
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
			</div>
			{quote && (
				<blockquote className="mt-10 max-w-2xl text-balance font-light text-neutral-500 text-xl italic sm:mt-12 sm:text-2xl">
					“{quote}”
				</blockquote>
			)}
		</div>
	);
}
