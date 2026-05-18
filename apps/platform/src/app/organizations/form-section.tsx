import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayleai/ui/card";
import type { ReactNode } from "react";

interface FormSectionProps {
	children: ReactNode;
	/**
	 * When true, render as a plain section (no Card chrome) — used in the
	 * onboarding wizard. When false (default), render the standard
	 * Card/CardHeader/CardContent layout used on the standalone settings pages.
	 */
	compact?: boolean;
	description?: ReactNode;
	title: ReactNode;
}

export function FormSection({
	children,
	compact,
	description,
	title,
}: FormSectionProps) {
	if (compact) {
		return (
			<section className="space-y-3">
				<div className="space-y-1">
					<h3 className="font-medium text-foreground text-sm">{title}</h3>
					{description ? (
						<p className="text-muted-foreground text-sm">{description}</p>
					) : null}
				</div>
				<div className="space-y-4">{children}</div>
			</section>
		);
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				{description ? <CardDescription>{description}</CardDescription> : null}
			</CardHeader>
			<CardContent className="space-y-4">{children}</CardContent>
		</Card>
	);
}
