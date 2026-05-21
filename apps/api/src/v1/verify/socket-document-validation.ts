import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { runActiveAuthValidation } from "./socket-active-auth-validation";
import { runAttestationValidation } from "./socket-attestation-validation";
import { runChipAuthValidation } from "./socket-chip-auth-validation";
import type { VerifySocketContext } from "./socket-context";
import { runPassiveAuthValidation } from "./socket-passive-auth-validation";

export async function runDocumentPhaseValidation({
	context,
	sessionId,
}: {
	context: VerifySocketContext;
	sessionId: string;
}): Promise<VerifyServerCheckResult | null> {
	const { dg1, dg2, sod } = context.state.transfer;

	if (!(dg1 && dg2 && sod)) {
		return null;
	}

	const attestCheckResult = await runAttestationValidation({
		sessionId,
		context,
	});
	if (attestCheckResult) {
		return attestCheckResult;
	}

	const passiveAuthResult = await runPassiveAuthValidation({
		sessionId,
		context,
	});
	if (!passiveAuthResult.ok) {
		return passiveAuthResult.checkResult;
	}

	const chipAuthCheckResult = await runChipAuthValidation({
		sessionId,
		context,
		sodDeclaresDg14: passiveAuthResult.sodDeclares.dg14,
	});
	if (chipAuthCheckResult) {
		return chipAuthCheckResult;
	}

	return runActiveAuthValidation({
		sessionId,
		context,
		sodDeclaresDg15: passiveAuthResult.sodDeclares.dg15,
	});
}
