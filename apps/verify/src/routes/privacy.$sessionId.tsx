import { sessionIdSchema } from "@api/shared/validation";
import { getVerifyHandoffCopy } from "@kayle-id/translations/verify-handoff-copy";
import { Layout } from "@kayleai/ui/layout";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { PrivacyRequestPage } from "@/app/privacy-request";
import { VERIFY_LAYOUT_CLASS_NAME } from "@/app/verification";

export const Route = createFileRoute("/privacy/$sessionId")({
	component: PrivacyRoute,
	loader: ({ params }) => {
		const { sessionId } = params;

		if (!sessionIdSchema.safeParse(sessionId).success) {
			throw notFound({
				data: {
					type: "invalid_session_id",
				},
			});
		}

		return { sessionId };
	},
	head: ({
		match: {
			context: { initialLocale = "en" },
		},
	}) => {
		const head = getVerifyHandoffCopy(initialLocale).privacyRequest.head;
		return {
			meta: [
				{
					title: head.pageTitle,
					description: head.pageDescription,
				},
			],
		};
	},
});

function PrivacyRoute() {
	return (
		<Layout className={VERIFY_LAYOUT_CLASS_NAME}>
			<PrivacyRequestPage />
		</Layout>
	);
}
