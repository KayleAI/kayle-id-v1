import { sessionIdSchema } from "@api/shared/validation";
import { getVerifyHandoffCopy } from "@kayle-id/translations/verify-handoff-copy";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { VerificationApp } from "@/app/verification";

export const Route = createFileRoute("/$")({
	component: VerificationApp,
	loader: ({ params }) => {
		const sessionId = params._splat;

		if (!sessionId) {
			throw notFound();
		}

		// validate the session id
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
		const head = getVerifyHandoffCopy(initialLocale).head;
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
