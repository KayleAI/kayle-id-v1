import { sessionIdSchema } from "@api/shared/validation";
import { getVerifyHandoffCopy } from "@kayle-id/translations/verify-handoff-copy";
import { Layout } from "@kayle-id/ui/components/layout";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
	PrivacyRequestPage,
	type PrivacyRequestRouteContext,
} from "@/app/privacy-request";
import { VERIFY_LAYOUT_CLASS_NAME } from "@/app/verification";
import { env } from "@/config/env.server";

export const Route = createFileRoute("/$sessionId/privacy")({
	component: PrivacyRoute,
	validateSearch: (search: Record<string, unknown>) => {
		const cancelToken = search.cancel_token;

		return {
			cancel_token:
				typeof cancelToken === "string" && cancelToken.length > 0
					? cancelToken
					: undefined,
		};
	},
	loader: async ({ params }) => {
		const { sessionId } = params;

		if (!sessionIdSchema.safeParse(sessionId).success) {
			throw notFound({
				data: {
					type: "invalid_session_id",
				},
			});
		}

		return getPrivacyRequestRouteContext({ data: { sessionId } });
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

type VerifyApiEnvelope<T> = {
	data: T | null;
	error: {
		code: string;
		message: string;
	} | null;
};

const getPrivacyRequestRouteContext = createServerFn({ method: "GET" })
	.inputValidator((data: { sessionId: string }) => {
		const parsed = sessionIdSchema.safeParse(data.sessionId);
		if (!parsed.success) {
			throw notFound({
				data: {
					type: "invalid_session_id",
				},
			});
		}

		return {
			sessionId: parsed.data,
		};
	})
	.handler(async ({ data }): Promise<PrivacyRequestRouteContext> => {
		const response = await env.API.fetch(
			`http://api/v1/verify/session/${encodeURIComponent(data.sessionId)}/privacy-context`,
			{ method: "GET" },
		);

		if (response.status === 404) {
			return {
				kind: "not_found",
				session_id: data.sessionId,
			};
		}

		const payload = (await response.json()) as VerifyApiEnvelope<
			Omit<Extract<PrivacyRequestRouteContext, { kind: "found" }>, "kind">
		>;

		if (!(response.ok && payload.data) || payload.error) {
			throw new Error(
				payload.error?.message ?? "Failed to load privacy options context.",
			);
		}

		return {
			kind: "found",
			...payload.data,
		};
	});

function PrivacyRoute() {
	const { cancel_token: cancelToken } = Route.useSearch();
	const context = Route.useLoaderData();

	return (
		<Layout className={VERIFY_LAYOUT_CLASS_NAME}>
			<PrivacyRequestPage cancelToken={cancelToken ?? null} context={context} />
		</Layout>
	);
}
