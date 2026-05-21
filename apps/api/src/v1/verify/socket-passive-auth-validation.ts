import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { logEvent } from "@kayle-id/config/logging";
import {
	completeCheckWithNegativeSignal,
	sendCheckResultAndMaybeClose,
} from "./socket-check-result";
import type { VerifySocketContext } from "./socket-context";
import { validateAuthenticity } from "./validation";
import type { SodDeclares } from "./validation-types";

export async function runPassiveAuthValidation({
	sessionId,
	context,
}: {
	sessionId: string;
	context: VerifySocketContext;
}): Promise<
	| {
			ok: true;
			sodDeclares: SodDeclares;
	  }
	| {
			ok: false;
			checkResult: VerifyServerCheckResult;
	  }
> {
	const { dg1, dg2, dg14, dg15, sod } = context.state.transfer;

	if (!(dg1 && dg2 && sod)) {
		throw new Error("passive_auth_required_artifacts_missing");
	}

	const authenticity = await validateAuthenticity({
		dg1,
		dg2,
		dg14,
		dg15,
		sod,
	});

	if (!authenticity.ok) {
		logEvent(context.log, {
			details: {
				session_id: sessionId,
				crl_status: authenticity.crlStatus,
				dg14_uploaded: dg14 !== undefined,
				dg15_uploaded: dg15 !== undefined,
				passive_auth_detail: authenticity.detail ?? null,
				passive_auth_reason: authenticity.reason,
				revocation_outcome: authenticity.revocationOutcome,
				signer_source: authenticity.signerSource,
			},
			event: "verify.ws.passive_auth_failed",
		});

		const checkResult = await completeCheckWithNegativeSignal({
			code: "document_authenticity_failed",
			context,
			riskScore: 1,
		});
		sendCheckResultAndMaybeClose(context, checkResult);
		return { ok: false, checkResult };
	}

	logEvent(context.log, {
		details: {
			session_id: sessionId,
			crl_status: authenticity.crlStatus,
			dg14_uploaded: dg14 !== undefined,
			dg15_uploaded: dg15 !== undefined,
			passive_auth_algorithm: authenticity.algorithm,
			revocation_outcome: authenticity.revocationOutcome,
			signer_source: authenticity.signerSource,
			sod_declares_dg14: authenticity.sodDeclares.dg14,
			sod_declares_dg15: authenticity.sodDeclares.dg15,
		},
		event: "verify.ws.passive_auth_succeeded",
	});

	return { ok: true, sodDeclares: authenticity.sodDeclares };
}
