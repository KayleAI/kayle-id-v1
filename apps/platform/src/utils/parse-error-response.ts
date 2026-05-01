function getErrorMessage(payload: unknown): string | null {
	if (!(payload && typeof payload === "object")) {
		return null;
	}

	const error = Reflect.get(payload, "error");
	if (!(error && typeof error === "object")) {
		return null;
	}

	const message = Reflect.get(error, "message");
	return typeof message === "string" && message.trim().length > 0
		? message
		: null;
}

export async function parseErrorResponse(
	response: Response,
	defaultError: string,
): Promise<string> {
	const text = await response.text();
	const fallbackText = text.trim();

	if (!fallbackText) {
		return defaultError;
	}

	try {
		return getErrorMessage(JSON.parse(text)) ?? defaultError;
	} catch {
		return fallbackText;
	}
}
