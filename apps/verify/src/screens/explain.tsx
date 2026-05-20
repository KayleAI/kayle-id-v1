import { interpolate } from "@kayle-id/translations/i18n";
import { Button } from "@kayle-id/ui/components/button";
import type { ReactNode } from "react";
import { PageShell } from "@/components/page-shell";
import { useVerifyHandoffCopy } from "@/i18n/provider";
import { useVerificationStore } from "@/stores/session";
import { OrganizationName } from "./organization/name";
import type { Organization } from "./organization/types";

type SessionExplainProps = {
	organization: Organization;
	isAgeOnly?: boolean;
	ageThreshold?: number | null;
};

export function SessionExplain({
	organization,
	isAgeOnly = false,
	ageThreshold = null,
}: SessionExplainProps) {
	const goToConsent = useVerificationStore((state) => state.goToConsent);
	const copy = useVerifyHandoffCopy();
	const explainCopy = copy.screens.explain;

	const sections = isAgeOnly
		? buildAgeOnlySections({ ageThreshold, copy: explainCopy, organization })
		: buildFullSections({ copy: explainCopy, organization });

	return (
		<PageShell
			heading={sections.heading}
			description={sections.intro}
			actions={
				<Button onClick={goToConsent} type="button">
					{explainCopy.continueButton}
				</Button>
			}
		>
			<div className="my-8 flex-1 space-y-6">
				<BulletSection
					title={sections.processTitle}
					bullets={sections.bullets}
				/>
				<BulletSection
					title={explainCopy.kayleIdTitle}
					bullets={[
						explainCopy.kayleIdBulletNoStorage,
						explainCopy.kayleIdBulletNoAccount,
						explainCopy.kayleIdBulletSessionScoped,
						explainCopy.kayleIdBulletRetention,
						explainCopy.kayleIdBulletNoDecision,
					]}
				/>
			</div>
		</PageShell>
	);
}

function BulletSection({
	title,
	bullets,
}: {
	title: string;
	bullets: ReactNode[];
}) {
	return (
		<div>
			<h3 className="mb-2 font-medium text-base text-foreground">{title}</h3>
			<ul className="list-disc space-y-1 pl-5 text-base text-muted-foreground">
				{bullets.map((bullet, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: bullets are static per render
					<li key={index}>{bullet}</li>
				))}
			</ul>
		</div>
	);
}

type ExplainCopy = ReturnType<
	typeof useVerifyHandoffCopy
>["screens"]["explain"];

function buildFullSections({
	copy,
	organization,
}: {
	copy: ExplainCopy;
	organization: Organization;
}) {
	return {
		heading: copy.headline,
		intro: copy.intro,
		processTitle: copy.processTitle,
		bullets: [
			copy.processBulletAuthentic,
			copy.processBulletHolder,
			<>
				{copy.processBulletSharingPrefix}
				<OrganizationName organization={organization} />
				{copy.processBulletSharingSuffix}
			</>,
			<>
				{copy.processBulletDecisionPrefix}
				<OrganizationName organization={organization} />
				{copy.processBulletDecisionSuffix}
			</>,
		] as ReactNode[],
	};
}

function buildAgeOnlySections({
	ageThreshold,
	copy,
	organization,
}: {
	ageThreshold: number | null;
	copy: ExplainCopy;
	organization: Organization;
}) {
	const ageOnly = copy.ageOnly;
	const ageLabel =
		ageThreshold !== null
			? interpolate(ageOnly.ageLabelWithThreshold, { threshold: ageThreshold })
			: ageOnly.ageLabelGeneric;
	const heading =
		ageThreshold !== null
			? interpolate(ageOnly.headlineWithThreshold, { threshold: ageThreshold })
			: ageOnly.headlineGeneric;
	const introSuffix = interpolate(ageOnly.introSuffix, { ageLabel });
	const yesNoQuestion = interpolate(ageOnly.yesNoBulletQuestion, { ageLabel });

	return {
		heading,
		intro: (
			<>
				{ageOnly.introPrefix}
				<OrganizationName isAgeOnly organization={organization} />
				{introSuffix}
			</>
		),
		processTitle: ageOnly.whatGetsSharedTitle,
		bullets: [
			<>
				{ageOnly.yesNoBulletPrefix}
				<span className="font-medium text-foreground">{yesNoQuestion}</span>
			</>,
			ageOnly.nothingElseBullet,
		] as ReactNode[],
	};
}
