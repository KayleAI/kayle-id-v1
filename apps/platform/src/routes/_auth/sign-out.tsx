import { client } from "@kayle-id/auth/client";
import { Logo } from "@kayle-id/ui/components/logo";
import { createFileRoute } from "@tanstack/react-router";
import { useSingleEffect } from "react-haiku";

export const Route = createFileRoute("/_auth/sign-out")({
	component: SignOutPage,
});

function SignOutPage() {
	useSingleEffect(() => {
		void client
			.signOut()
			.catch(() => undefined)
			.finally(() => {
				window.location.href = "/";
			});
	});

	return (
		<div className="relative flex w-full flex-col items-center justify-center">
			<div className="w-full max-w-md space-y-8">
				<div>
					<div className="mb-8">
						<Logo className="" title="Kayle ID" />
					</div>
					<h1 className="mb-4 font-light text-3xl text-foreground tracking-tight">
						Signing you out
					</h1>
					<p className="text-pretty text-lg text-muted-foreground">
						We&apos;re ending your Kayle ID session.
					</p>
				</div>
			</div>
		</div>
	);
}
