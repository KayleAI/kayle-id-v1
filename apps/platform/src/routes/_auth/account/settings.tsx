import { createFileRoute } from "@tanstack/react-router";
import { PasskeysList } from "@/app/passkeys";

export const Route = createFileRoute("/_auth/account/settings")({
	component: AccountSettingsLayout,
});

function AccountSettingsLayout() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
			<div>
				<h1 className="font-light text-3xl text-foreground tracking-tight">
					Account Settings
				</h1>
				<p className="text-muted-foreground">
					Manage how you sign in to Kayle ID.
				</p>
			</div>
			<PasskeysList />
		</div>
	);
}
