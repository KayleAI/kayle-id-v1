import type { ReactNode } from "react";

interface LegalSectionProps {
	children: ReactNode;
	title: string;
}

interface LegalSubsectionProps {
	children: ReactNode;
	title: string;
}

interface LegalListProps {
	items: string[];
}

export function LegalSection({ title, children }: LegalSectionProps) {
	return (
		<section className="space-y-6 border-border/70 border-t pt-12 first:border-t-0 first:pt-0 sm:space-y-8 sm:pt-16">
			<h2 className="mx-auto max-w-[24ch] text-balance text-center font-light text-3xl text-foreground tracking-tighter sm:text-4xl">
				{title}
			</h2>
			<div className="space-y-4 text-muted-foreground leading-relaxed">
				{children}
			</div>
		</section>
	);
}

export function LegalSubsection({ title, children }: LegalSubsectionProps) {
	return (
		<div className="space-y-3">
			<h3 className="font-medium text-foreground text-lg">{title}</h3>
			{children}
		</div>
	);
}

export function LegalList({ items }: LegalListProps) {
	return (
		<ul className="list-disc space-y-2 pl-5 text-muted-foreground leading-relaxed marker:text-muted-foreground/45">
			{items.map((item) => (
				<li key={item}>{item}</li>
			))}
		</ul>
	);
}
