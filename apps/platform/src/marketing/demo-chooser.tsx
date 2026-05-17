import { Link } from "@tanstack/react-router";
import { ArrowUpRightIcon } from "lucide-react";
import { IconLockPassword, IconWalletCard } from "nucleo-isometric";
import type { ComponentType } from "react";

type IsometricIcon = ComponentType<{
	className?: string;
	size?: number | string;
}>;

interface DemoChooserOption {
	Icon: IsometricIcon;
	title: string;
	description: string;
	to: "/demo/id" | "/demo/age";
	cta: string;
}

interface LegalLink {
	title: string;
	description: string;
	to: "/terms" | "/privacy";
}

const legalLinks: ReadonlyArray<LegalLink> = [
	{
		title: "Terms of service",
		description: "The rules that apply when you use Kayle ID and this demo.",
		to: "/terms",
	},
	{
		title: "Privacy policy",
		description:
			"How Kayle handles personal data, including temporary demo metadata.",
		to: "/privacy",
	},
];

const options: ReadonlyArray<DemoChooserOption> = [
	{
		Icon: IconWalletCard,
		title: "ID check",
		description:
			"Verify identity claims like name, date of birth, nationality, and document photo — read straight from the chip.",
		to: "/demo/id",
		cta: "Try ID check",
	},
	{
		Icon: IconLockPassword,
		title: "Age verification",
		description:
			"Check whether someone meets an age requirement without collecting their birth date.",
		to: "/demo/age",
		cta: "Try age verification",
	},
];

export function DemoChooser() {
	return (
		<main className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
			<section className="mb-16 sm:mb-20">
				<h1 className="mx-auto max-w-[22ch] text-balance text-center font-light text-5xl text-foreground tracking-tighter sm:text-6xl">
					Try Kayle ID in your browser.
				</h1>
				<p className="mx-auto mt-6 max-w-[56ch] text-balance text-center text-lg text-muted-foreground sm:mt-8 sm:text-xl">
					Pick a demo to walk through. Both run end-to-end in your local
					browser, then automatically delete themselves.
				</p>
			</section>

			<div className="grid gap-6 md:grid-cols-2 lg:gap-8">
				{options.map((option) => (
					<Link
						className="group rounded-2xl border border-border/70 bg-card/70 p-8 transition-colors hover:border-border hover:bg-muted/50"
						key={option.to}
						to={option.to}
					>
						<option.Icon
							className="text-emerald-700 dark:text-emerald-400"
							size={56}
						/>
						<h2 className="mt-6 font-light text-2xl text-foreground tracking-tight">
							{option.title}
						</h2>
						<p className="mt-3 text-muted-foreground text-pretty leading-relaxed">
							{option.description}
						</p>
						<span className="mt-6 inline-flex items-center font-medium text-emerald-700 text-sm group-hover:underline dark:text-emerald-400">
							{option.cta}
							<span aria-hidden="true" className="ml-1">
								→
							</span>
						</span>
					</Link>
				))}
			</div>

			<section className="mt-6 grid gap-3 md:grid-cols-2 md:gap-4">
				{legalLinks.map((link) => (
					<Link
						className="group rounded-2xl border border-border/70 bg-card/70 px-5 py-4 transition-colors hover:border-border hover:bg-muted/50"
						key={link.to}
						to={link.to}
					>
						<div className="flex items-center justify-between gap-3">
							<h3 className="font-medium text-foreground text-sm">
								{link.title}
							</h3>
							<ArrowUpRightIcon
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground"
							/>
						</div>
						<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
							{link.description}
						</p>
					</Link>
				))}
			</section>
		</main>
	);
}
