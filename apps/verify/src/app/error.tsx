import InfoCard from "@kayle-id/ui/info-card";
import { useErrorMessages, useVerifyHandoffCopy } from "@/i18n/provider";
import { useSession } from "./session-provider";

export function SessionError() {
	const { error } = useSession();

	if (!error) {
		return null;
	}

	return <ErrorCard error={error} />;
}

export function ErrorCard({
	error,
}: {
	error: {
		code: string;
		message: string;
	};
}) {
	const errorMessages = useErrorMessages();
	const copy = useVerifyHandoffCopy();
	const sessionErrorCopy = copy.screens.sessionError;
	const errorMessage =
		errorMessages[error.code as keyof typeof errorMessages] ??
		errorMessages.UNKNOWN;

	return (
		<InfoCard
			colour="red"
			header={{
				title: sessionErrorCopy.headerTitle,
				description: sessionErrorCopy.headerDescription,
			}}
			message={{
				title: errorMessage.title,
				description: errorMessage.description,
			}}
		/>
	);
}
