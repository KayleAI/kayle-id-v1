import { z } from "zod";

export const sessionIdSchema = z
	.string()
	.regex(/^vs_[A-Za-z0-9]{64}$/, "Invalid session ID format");

export const verificationAttemptIdSchema = z
	.string()
	.regex(/^va_[A-Za-z0-9]{64}$/, "Invalid verification attempt ID format");
