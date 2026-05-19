/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { OnboardingPreviewPane } from "./preview-pane";

const businessDraft = {
	businessType: "business" as const,
	businessName: "Old Legal Ltd",
	businessJurisdiction: "Old jurisdiction",
	businessRegistrationNumber: "OLD-123",
};

const publicDraft = {
	name: "Old Org",
	description: "Old description",
	website: "https://old.example",
	privacyPolicyUrl: "https://old.example/privacy",
	termsOfServiceUrl: "https://old.example/terms",
	logoPreview: null,
};

afterEach(() => {
	cleanup();
});

describe("OnboardingPreviewPane", () => {
	test("replaces live draft text without retaining animated stale values", () => {
		const view = render(
			<OnboardingPreviewPane
				activeStep="public"
				businessDraft={businessDraft}
				isOwnerIdVerified={false}
				publicDraft={publicDraft}
			/>,
		);

		view.rerender(
			<OnboardingPreviewPane
				activeStep="public"
				businessDraft={{
					...businessDraft,
					businessName: "New Legal Ltd",
				}}
				isOwnerIdVerified={false}
				publicDraft={{
					...publicDraft,
					name: "New Org",
				}}
			/>,
		);

		expect(screen.getByText("About New Org")).not.toBeNull();
		expect(screen.getByText("New Org")).not.toBeNull();
		expect(screen.getByText("New Legal Ltd")).not.toBeNull();
		expect(screen.queryByText("About Old Org")).toBeNull();
		expect(screen.queryByText("Old Org")).toBeNull();
		expect(screen.queryByText("Old Legal Ltd")).toBeNull();
	});
});
