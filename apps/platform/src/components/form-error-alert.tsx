import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@kayle-id/ui/components/alert";

interface FormErrorAlertProps {
	message: string;
	title?: string;
}

export function FormErrorAlert({
	message,
	title = "Error",
}: FormErrorAlertProps) {
	if (!message) {
		return null;
	}
	return (
		<Alert variant="destructive">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}
