import { bodyLimit } from "hono/body-limit";

export const API_REQUEST_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

export const requestBodyLimitMiddleware = bodyLimit({
	maxSize: API_REQUEST_BODY_LIMIT_BYTES,
	onError: (c) =>
		c.json(
			{
				error: {
					code: "PAYLOAD_TOO_LARGE",
					message: "Request body is too large.",
				},
			},
			413,
		),
});
