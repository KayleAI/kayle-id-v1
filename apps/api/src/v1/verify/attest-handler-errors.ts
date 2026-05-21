import type { Context } from "hono";
import { createVerifyJsonErrorResponse } from "./error-response";

export function attestJsonError(
	c: Context,
	code: "HELLO_ATTEST_INVALID" | "INVALID_REQUEST",
	status: 400 | 401,
): Response {
	const response = createVerifyJsonErrorResponse({
		code,
		status,
	});

	return c.json(
		{
			data: response.data,
			error: response.error,
		},
		response.status,
	);
}
