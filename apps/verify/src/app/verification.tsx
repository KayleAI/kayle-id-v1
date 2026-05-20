import { Layout } from "@kayle-id/ui/components/layout";
import { useLoaderData } from "@tanstack/react-router";
import { SessionApp } from "./app";
import { SessionError } from "./error";
import { SessionLoader } from "./loader";
import { SessionProvider } from "./session-provider";

export const VERIFY_LAYOUT_CLASS_NAME =
	"lg:rounded-[1.75rem]! lg:border-neutral-200/80! lg:bg-white/94! lg:shadow-[0_24px_80px_-48px_rgba(15,23,42,0.16)]! lg:backdrop-blur-xl! dark:lg:border-neutral-800/80! dark:lg:bg-neutral-900/94! dark:lg:shadow-[0_24px_80px_-48px_rgba(0,0,0,0.6)]!";

export function VerificationApp() {
	const { sessionId } = useLoaderData({
		from: "/$",
	});

	return (
		<Layout className={VERIFY_LAYOUT_CLASS_NAME}>
			<SessionProvider sessionId={sessionId}>
				<SessionApp />
				<SessionError />
				<SessionLoader />
			</SessionProvider>
		</Layout>
	);
}
