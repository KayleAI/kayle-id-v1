import { Layout } from "@kayle-id/ui/components/layout";
import { InfoCard } from "@kayle-id/ui/info-card";
import type { NotFoundRouteProps } from "@tanstack/react-router";
import { useErrorMessages, useVerifyHandoffCopy } from "@/i18n/provider";

/**
 * The not found component.
 *
 * This component is reserved only for when a session is not found, has expired, or is otherwise invalid.
 *
 * This informs the user that it's an issue on their end.
 *
 * @note Not to be confused with the error page which is reserved for when issues occur on our end.
 *
 * @returns A not found component.
 */
type InvalidSessionData = {
	data?: {
		type?: string;
	};
};

function isInvalidSessionData(data: unknown): data is InvalidSessionData {
	return typeof data === "object" && data !== null && "data" in data;
}

export function NotFound({ data }: NotFoundRouteProps) {
	const errorMessages = useErrorMessages();
	const copy = useVerifyHandoffCopy();
	const notFoundCopy = copy.screens.notFound;
	const invalidData = isInvalidSessionData(data) ? data : undefined;

	if (invalidData?.data?.type === "invalid_session_id") {
		const errorMessage = errorMessages.INVALID_SESSION_ID;
		return (
			<InfoCard
				buttons={{
					primary: {
						label: notFoundCopy.goBackButton,
						onClick: () => window.history.back(),
					},
				}}
				colour="red"
				header={{
					title: errorMessage.title,
					description: errorMessage.description,
				}}
				message={{
					title: errorMessage.title,
					description: errorMessage.description,
				}}
			/>
		);
	}

	// Generic not found page
	return (
		<Layout>
			<InfoCard
				colour="red"
				header={{
					title: notFoundCopy.headerTitle,
					description: notFoundCopy.headerDescription,
				}}
				message={{
					title: notFoundCopy.messageTitle,
					description: notFoundCopy.messageDescription,
				}}
			/>
		</Layout>
	);
}
