import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@kayle-id/ui/components/card";
import type { ReactNode } from "react";

interface FormSectionProps {
	children: ReactNode;
	// Plain section (no Card chrome) for the onboarding wizard.
	compact?: boolean;
	description?: ReactNode;
	title?: ReactNode;
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
					{title ? (
						<h3 className="font-medium text-foreground text-sm">{title}</h3>
					) : null}
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
			{title || description ? (
				<CardHeader>
					{title ? <CardTitle>{title}</CardTitle> : null}
					{description ? (
						<CardDescription>{description}</CardDescription>
					) : null}
				</CardHeader>
			) : null}
			<CardContent className="space-y-4">{children}</CardContent>
		</Card>
	);
}
