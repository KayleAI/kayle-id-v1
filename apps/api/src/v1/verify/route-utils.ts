import type { Context } from "hono";
import { z } from "zod";
import { sessionIdSchema } from "@/shared/validation";
import { createVerifyJsonErrorResponse } from "./error-response";

export const sessionParamSchema = z.object({ id: sessionIdSchema });

export type SessionParam = z.infer<typeof sessionParamSchema>;

type VerifyJsonErrorInput = Parameters<typeof createVerifyJsonErrorResponse>[0];

export function verifyJsonError(
	c: Context,
	input: VerifyJsonErrorInput,
): Response {
	const response = createVerifyJsonErrorResponse(input);

	return c.json(
		{
			data: response.data,
			error: response.error,
		},
		response.status,
	);
}

export function invalidVerifyRequestJson(c: Context): Response {
	return verifyJsonError(c, {
		code: "INVALID_REQUEST",
		status: 400,
	});
}

export function validateSessionParam(value: unknown): SessionParam | null {
	const parsed = sessionParamSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

export function sessionParamJsonValidator(
	value: unknown,
	c: Context,
): Response | SessionParam {
	const parsed = validateSessionParam(value);

	if (parsed) {
		return parsed;
	}

	return verifyJsonError(c, {
		code: "INVALID_SESSION_ID",
		status: 400,
	});
}
