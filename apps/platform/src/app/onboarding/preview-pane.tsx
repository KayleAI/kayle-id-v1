import OctagonCheck from "@kayle-id/ui/icons/octagon-check";
import OctagonWarning from "@kayle-id/ui/icons/octagon-warning";
import { cn } from "@kayleai/ui/utils/cn";
import { AnimatePresence, motion } from "motion/react";
import type { SVGProps } from "react";
import type { BusinessDetailsDraftValues } from "@/app/organizations/business";
import type { PublicDetailsDraftValues } from "@/app/organizations/public-details";
import type { OnboardingRouteStep } from "./shell-context";

/**
 * Mirrors the verify app's `OrganizationName` about-dialog so the org owner
 * sees, in real time, the card their end users will see during verification.
 * Copy strings (title, callout text, field labels) are kept literally in sync
 * with `packages/translations/src/en/verify-handoff-copy.ts`. The heading
 * text "What your users will see" lives *outside* and *above* the card so
 * the card itself reads as a faithful preview, not a wizard annotation.
 */
export function OnboardingPreviewPane({
	activeStep,
	businessDraft,
	isOwnerIdVerified,
	publicDraft,
}: {
	activeStep: OnboardingRouteStep;
	businessDraft: BusinessDetailsDraftValues;
	isOwnerIdVerified: boolean;
	publicDraft: PublicDetailsDraftValues;
}) {
	const focus: "public" | "business" | "owner-id" | null =
		activeStep === "public" ||
		activeStep === "business" ||
		activeStep === "owner-id"
			? activeStep
			: null;

	return (
		<div className="flex h-full w-full items-center justify-center px-8 py-10">
			<div className="w-full max-w-md space-y-3">
				<PreviewHeading />
				<div className="w-full">
					<PreviewCard
						businessDraft={businessDraft}
						focus={focus}
						isOwnerIdVerified={isOwnerIdVerified}
						publicDraft={publicDraft}
					/>
				</div>
			</div>
		</div>
	);
}

function PreviewHeading() {
	return (
		<div className="space-y-1 px-1 mx-6">
			<p className="font-medium text-foreground text-sm">
				What your users will see
			</p>
			<p className="text-muted-foreground text-xs">
				A live preview of the &quot;About&quot; dialog from the verify flow.
			</p>
		</div>
	);
}

function PreviewCard({
	businessDraft,
	focus,
	isOwnerIdVerified,
	publicDraft,
}: {
	businessDraft: BusinessDetailsDraftValues;
	focus: "public" | "business" | "owner-id" | null;
	isOwnerIdVerified: boolean;
	publicDraft: PublicDetailsDraftValues;
}) {
	const name = publicDraft.name.trim() || "Your organization";

	return (
		<div className="overflow-hidden rounded-3xl border border-border bg-background p-6 text-foreground">
			<div className="space-y-4">
				<DialogHeaderPreview name={name} />
				<FocusSection focused={focus === "public"}>
					<IdentityCard name={name} publicDraft={publicDraft} />
				</FocusSection>
				<div className="flex flex-col gap-2">
					<FocusSection focused={focus === "owner-id"}>
						<VerificationStatusCallout verified={isOwnerIdVerified} />
					</FocusSection>
					<FocusSection focused={focus === "business"}>
						<DetailsList
							businessDraft={businessDraft}
							publicName={publicDraft.name}
						/>
					</FocusSection>
					<FocusSection focused={focus === "public"}>
						<PolicyLinks publicDraft={publicDraft} />
					</FocusSection>
				</div>
			</div>
		</div>
	);
}

function DialogHeaderPreview({ name }: { name: string }) {
	return (
		<div className="space-y-2">
			<p className="font-medium text-foreground text-lg">{`About ${name}`}</p>
			<p className="text-muted-foreground text-sm">
				To help protect you, we&apos;re showing you some information about the
				organization requesting this check.
			</p>
		</div>
	);
}

function FocusSection({
	children,
	focused,
}: {
	children: React.ReactNode;
	focused: boolean;
}) {
	return (
		<motion.div
			animate={{ opacity: focused ? 1 : 0.6 }}
			className={cn(
				"rounded-xl transition-shadow",
				focused
					? "ring-2 ring-foreground/15 ring-offset-2 ring-offset-background"
					: "",
			)}
			transition={{ duration: 0.3, ease: "easeOut" }}
		>
			{children}
		</motion.div>
	);
}

function IdentityCard({
	name,
	publicDraft,
}: {
	name: string;
	publicDraft: PublicDetailsDraftValues;
}) {
	const description = publicDraft.description.trim();
	const initial = name.charAt(0).toUpperCase();
	const logo = publicDraft.logoPreview;

	return (
		<div className="flex items-start gap-3 p-2">
			<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
				<AnimatePresence mode="popLayout">
					{logo ? (
						<motion.img
							alt=""
							animate={{ opacity: 1, scale: 1 }}
							className="size-full object-cover"
							exit={{ opacity: 0, scale: 0.9 }}
							height={48}
							initial={{ opacity: 0, scale: 0.9 }}
							key={logo}
							src={logo}
							transition={{ duration: 0.25 }}
							width={48}
						/>
					) : (
						<motion.span
							animate={{ opacity: 1 }}
							aria-hidden="true"
							className="font-medium text-foreground text-lg"
							exit={{ opacity: 0 }}
							initial={{ opacity: 0 }}
							key="initial"
						>
							{initial}
						</motion.span>
					)}
				</AnimatePresence>
			</div>
			<div className="min-w-0 flex-1 space-y-0.5">
				<p
					className={cn(
						"font-medium text-base",
						publicDraft.name.trim()
							? "text-foreground"
							: "text-muted-foreground italic",
					)}
				>
					{name}
				</p>
				<AnimatePresence mode="popLayout">
					{description ? (
						<motion.p
							animate={{ opacity: 1, y: 0 }}
							className="text-muted-foreground text-sm"
							exit={{ opacity: 0, y: -4 }}
							initial={{ opacity: 0, y: 4 }}
							key="description"
							transition={{ duration: 0.25 }}
						>
							{description}
						</motion.p>
					) : (
						<motion.p
							animate={{ opacity: 1 }}
							className="text-muted-foreground/60 text-sm italic"
							exit={{ opacity: 0 }}
							initial={{ opacity: 0 }}
							key="description-placeholder"
							transition={{ duration: 0.25 }}
						>
							A short description of your organization.
						</motion.p>
					)}
				</AnimatePresence>
			</div>
		</div>
	);
}

function VerificationStatusCallout({ verified }: { verified: boolean }) {
	if (verified) {
		return (
			<div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 dark:border-emerald-900 dark:bg-emerald-950/40">
				<OctagonCheck
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-400"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-emerald-800 text-sm dark:text-emerald-200">
						Owner ID check completed
					</p>
					<p className="mt-1 text-emerald-700 text-sm dark:text-emerald-300">
						A verified owner has completed Kayle ID&apos;s owner identity check.
					</p>
				</div>
			</div>
		);
	}
	return (
		<div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 dark:border-red-900 dark:bg-red-950/40">
			<OctagonWarning
				aria-hidden="true"
				className="mt-0.5 size-5 shrink-0 text-red-500"
			/>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-red-800 text-sm dark:text-red-200">
					Owner ID check not completed
				</p>
				<p className="mt-1 text-pretty text-red-700 text-sm dark:text-red-300">
					Kayle ID has not independently verified the people running this
					organization. Only continue if you trust this request.
				</p>
			</div>
		</div>
	);
}

function DetailsList({
	businessDraft,
	publicName,
}: {
	businessDraft: BusinessDetailsDraftValues;
	publicName: string;
}) {
	const isSole = businessDraft.businessType === "sole";
	const labels = isSole
		? {
				name: "Full name",
				jurisdiction: "Country",
				registrationNumber: "Tax / trader ID",
			}
		: {
				name: "Legal name",
				jurisdiction: "Registered in",
				registrationNumber: "Registration number",
			};

	const items: {
		filled: boolean;
		key: string;
		label: string;
		value: string;
	}[] = [
		{
			filled: businessDraft.businessName.trim().length > 0,
			key: "name",
			label: labels.name,
			value:
				businessDraft.businessName.trim() ||
				(isSole ? "Your full name" : publicName.trim() || "Your legal name"),
		},
		{
			filled: businessDraft.businessJurisdiction.trim().length > 0,
			key: "jurisdiction",
			label: labels.jurisdiction,
			value:
				businessDraft.businessJurisdiction.trim() ||
				(isSole ? "Where you operate" : "United Kingdom"),
		},
		{
			filled: businessDraft.businessRegistrationNumber.trim().length > 0,
			key: "registration",
			label: labels.registrationNumber,
			value: businessDraft.businessRegistrationNumber.trim() || "—",
		},
	];

	return (
		<dl className="divide-y divide-border/60 rounded-xl border border-border bg-muted/40 px-4 py-1 text-sm">
			{items.map((item) => (
				<div
					className="flex items-center justify-between gap-4 py-2.5"
					key={item.key}
				>
					<dt className="text-muted-foreground">{item.label}</dt>
					<dd
						className={cn(
							"break-all text-right font-medium",
							item.filled
								? "text-foreground"
								: "text-muted-foreground/60 italic",
						)}
					>
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

function PolicyLinks({
	publicDraft,
}: {
	publicDraft: PublicDetailsDraftValues;
}) {
	const links: {
		filled: boolean;
		href: string;
		key: string;
		label: string;
	}[] = [
		{
			filled: publicDraft.website.trim().length > 0,
			href: publicDraft.website.trim() || "https://your-website.example",
			key: "website",
			label: "Website",
		},
		{
			filled: publicDraft.privacyPolicyUrl.trim().length > 0,
			href:
				publicDraft.privacyPolicyUrl.trim() ||
				"https://your-website.example/privacy",
			key: "privacy",
			label: "Privacy policy",
		},
		{
			filled: publicDraft.termsOfServiceUrl.trim().length > 0,
			href:
				publicDraft.termsOfServiceUrl.trim() ||
				"https://your-website.example/terms",
			key: "terms",
			label: "Terms of service",
		},
	];

	return (
		<ul className="flex flex-col gap-2">
			{links.map((link) => (
				<li key={link.key}>
					<div
						className={cn(
							"group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors",
							link.filled
								? "border-border bg-muted/40"
								: "border-border border-dashed bg-muted/20",
						)}
					>
						<span
							className={cn(
								"font-medium text-sm",
								link.filled
									? "text-foreground"
									: "text-muted-foreground/70 italic",
							)}
						>
							{link.label}
						</span>
						<ArrowUpRightIcon
							aria-hidden="true"
							className={cn(
								"size-4 shrink-0",
								link.filled
									? "text-muted-foreground"
									: "text-muted-foreground/40",
							)}
						/>
					</div>
				</li>
			))}
		</ul>
	);
}

function ArrowUpRightIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.5"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<title>Opens in a new tab</title>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}
