import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";
import { getErrorMessage } from "@/utils/get-error-message";

interface QueryErrorAlertProps {
	error: unknown;
	fallback: string;
	title: string;
}

export function QueryErrorAlert({
	error,
	fallback,
	title,
}: QueryErrorAlertProps) {
	if (!error) {
		return null;
	}
	return (
		<Alert variant="destructive">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{getErrorMessage(error, fallback)}</AlertDescription>
		</Alert>
	);
}
