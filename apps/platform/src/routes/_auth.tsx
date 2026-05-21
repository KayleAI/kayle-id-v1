import { Layout } from "@kayle-id/ui/components/layout";
import { cn } from "@kayle-id/ui/lib/utils";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
});

function AuthLayout() {
	return (
		<Layout
			className={cn(
				"p-0 lg:p-0",
				"lg:rounded-[1.75rem]! lg:bg-white!",
				"lg:shadow-[0_24px_80px_-48px_rgba(15,23,42,0.16)]!",
				"dark:lg:bg-black!",
				"dark:lg:shadow-[0_24px_80px_-48px_rgba(0,0,0,0.6)]!",
			)}
			notCenter
		>
			<AuthFlowShell>
				<Outlet />
			</AuthFlowShell>
		</Layout>
	);
}

function AuthFlowShell({ children }: { children: ReactNode }) {
	return (
		<>
			<aside
				className={[
					"flex min-h-0 w-full flex-col overflow-y-auto overflow-x-hidden",
					"lg:my-4 lg:ml-4 lg:w-[480px] xl:w-[560px]",
					"lg:rounded-2xl dark:lg:bg-card lg:ring-1 lg:ring-border dark:lg:ring-0",
				].join(" ")}
			>
				<div className="flex flex-1 flex-col px-6 py-6 lg:px-10 lg:py-8">
					<div className="my-auto w-full">{children}</div>
				</div>
			</aside>
			<section aria-hidden="true" className="hidden flex-1 lg:block" />
		</>
	);
}
