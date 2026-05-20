import { useAuth } from "@kayle-id/auth/client/provider";
import { Button } from "@kayle-id/ui/components/button";
import { Link } from "@tanstack/react-router";
import {
	IconGlobe,
	IconLockPassword,
	IconShield,
	IconWalletCard,
} from "nucleo-isometric";
import type { ComponentType } from "react";

type IsometricIcon = ComponentType<{
	className?: string;
	size?: number | string;
}>;

const documentCoverage: ReadonlyArray<{
	Icon: IsometricIcon;
	title: string;
	description: string;
}> = [
	{
		Icon: IconWalletCard,
		title: "TD1 + TD2 — national ID cards",
		description:
			"Identity cards issued by EU member states, the UK, the US, and many others, parsed from the MRZ across both formats.",
	},
	{
		Icon: IconGlobe,
		title: "TD3 — passports",
		description:
			"ICAO 9303 passport books with the contactless chip, including biometric portraits used for face matching.",
	},
	{
		Icon: IconLockPassword,
		title: "Chip authentication",
		description:
			"Kayle performs Passive, Active, and Chip Authentication during the read — clones and replays do not pass.",
	},
];

const trustPillars: ReadonlyArray<{
	Icon: IsometricIcon;
	title: string;
	description: string;
}> = [
	{
		Icon: IconLockPassword,
		title: "End-to-end encrypted webhooks",
		description:
			"Sensitive claims are encrypted with your public key and can only be decrypted in your secure environment.",
	},
	{
		Icon: IconShield,
		title: "Document-bound trust",
		description:
			"Chip Authentication and Active Authentication establish that the chip is the original to prevent replay attacks and clones.",
	},
];

export function Homepage() {
	const { status } = useAuth();
	const ctaTo = status === "authenticated" ? "/dashboard" : "/sign-in";

	return (
		<main className="mx-auto max-w-7xl px-6 py-24 lg:px-8">
			{/* === Hero === */}
			<section className="mb-16 sm:mb-24">
				<h1 className="mx-auto mt-8 max-w-[20ch] text-balance text-center font-light text-6xl text-foreground tracking-tighter sm:text-7xl">
					Identity verification for high-trust products.
				</h1>
				<p className="mx-auto mt-6 max-w-[48ch] text-balance text-center font-medium text-lg text-muted-foreground sm:mt-8 sm:text-xl">
					Verify your users' identity or confirm their age with one coherent
					flow — with only the details you need, end-to-end-encrypted.
				</p>
				<div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
					<Button
						nativeButton={false}
						render={<Link to={ctaTo}>Get Started</Link>}
					/>
					<Button
						nativeButton={false}
						render={<Link to="/demo">Try demo</Link>}
						variant="outline"
					/>
				</div>
			</section>

			{/* === Documents coverage === */}
			<section className="mt-24 border-border/70 border-t pt-24">
				<h2 className="mx-auto mt-8 max-w-[24ch] text-balance text-center font-light text-4xl text-foreground tracking-tighter sm:text-5xl">
					Read passports and ID cards from over 200 countries.
				</h2>
				<p className="mx-auto mt-6 max-w-[56ch] text-balance text-center text-lg text-muted-foreground">
					ICAO 9303-compliant documents are read straight from the chip — not
					from a printed photo. Kayle handles passports and national ID cards
					with the same flow.
				</p>
				<dl className="mt-16 grid gap-6 lg:grid-cols-3 lg:gap-8">
					{documentCoverage.map((entry) => (
						<div
							className="rounded-2xl border border-border/70 bg-card/70 p-6"
							key={entry.title}
						>
							<entry.Icon
								className="text-emerald-700 dark:text-emerald-400"
								size={48}
							/>
							<dt className="mt-5 font-light text-foreground text-xl">
								{entry.title}
							</dt>
							<dd className="mt-3 text-muted-foreground text-pretty leading-relaxed">
								{entry.description}
							</dd>
						</div>
					))}
				</dl>
			</section>

			{/* === Trust & privacy === */}
			<section className="mt-24 border-border/70 border-t pt-24">
				<h2 className="mx-auto mt-8 max-w-[24ch] text-balance text-center font-light text-4xl text-foreground tracking-tighter sm:text-5xl">
					Built so we hold as little of your users' data as possible.
				</h2>
				<p className="mx-auto mt-6 max-w-[56ch] text-balance text-center text-lg text-muted-foreground">
					At Kayle, we place privacy at the core of what we do. We never store
					sensitive data, and we never pass it on to third parties.
				</p>

				<dl className="mt-16 grid gap-6 md:grid-cols-2 lg:gap-8">
					{trustPillars.map((pillar) => (
						<div
							className="rounded-2xl border border-border/70 bg-card/70 p-8"
							key={pillar.title}
						>
							<pillar.Icon
								className="text-emerald-700 dark:text-emerald-400"
								size={56}
							/>
							<dt className="mt-6 font-light text-2xl text-foreground tracking-tight">
								{pillar.title}
							</dt>
							<dd className="mt-3 text-muted-foreground text-pretty leading-relaxed">
								{pillar.description}
							</dd>
						</div>
					))}
				</dl>
			</section>

			{/* === Closing CTA === */}
			<section className="mt-24 border-border/70 border-t pt-24">
				<h2 className="mx-auto mt-8 max-w-[28ch] text-balance text-center font-light text-4xl text-foreground tracking-tighter sm:text-5xl">
					Bring Kayle's calmer, more legible design language into your identity
					flows.
				</h2>
				<p className="mx-auto mt-6 max-w-[48ch] text-balance text-center text-lg text-muted-foreground">
					Explore the live demo, then connect Kayle ID to your own onboarding or
					compliance journey.
				</p>
				<div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
					<Button
						nativeButton={false}
						render={<Link to={ctaTo}>Get Started</Link>}
					/>
					<Button
						nativeButton={false}
						render={<Link to="/demo">Try demo</Link>}
						variant="outline"
					/>
				</div>
			</section>
		</main>
	);
}
