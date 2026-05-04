import { createFileRoute } from "@tanstack/react-router";
import { VerifyTwoFactor } from "@/auth/verify-2fa";

export const Route = createFileRoute("/_auth/verify-2fa")({
	component: VerifyTwoFactor,
});
