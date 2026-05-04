import { createFileRoute } from "@tanstack/react-router";
import { TwoFactorAuthSection } from "@/app/account/two-factor";
import { AppHeading } from "@/components/app-shell/heading";

export const Route = createFileRoute("/_auth/account/settings")({
	component: AccountSettingsLayout,
});

function AccountSettingsLayout() {
	return (
		<div className="mx-auto flex h-full max-w-3xl flex-1 grow flex-col">
			<AppHeading
				description="Manage how you sign in to Kayle ID."
				title="Account settings"
			/>
			<hr className="my-8" />
			<TwoFactorAuthSection />
		</div>
	);
}
