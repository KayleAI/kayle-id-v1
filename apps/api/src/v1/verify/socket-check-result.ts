import type { VerifyServerCheckResult } from "@kayle-id/capnp/verify-codec";
import { triggerWebhookDeliveryWorkflows } from "@/v1/webhooks/deliveries/service";
import { resolveVerifyErrorMessage } from "./error-response";
import { markCheckFailed } from "./outcome";
import {
	failedCheckForCode,
	MAX_LIVENESS_RETRIES,
	MAX_NFC_RETRIES,
	type NegativeFailureCode,
} from "./retry-limits";
import type { VerifySocketContext } from "./socket-context";

export async function completeCheckWithNegativeSignal({
	code,
	context,
	riskScore,
}: {
	code: NegativeFailureCode;
	context: VerifySocketContext;
	riskScore: number;
}): Promise<VerifyServerCheckResult> {
	const result = await markCheckFailed({
		session: context.session,
		failureCode: code,
		riskScore,
	});

	if (result.deliveryIds.length > 0) {
		context.scheduleTask(
			triggerWebhookDeliveryWorkflows({
				env: context.env,
				deliveryIds: result.deliveryIds,
			}),
		);
	}

	return {
		outcome: "not_confirmed",
		reasonCode: code,
		reasonMessage: resolveVerifyErrorMessage(code),
		retryAllowed: !result.terminalized,
		failedCheck: failedCheckForCode(code),
		remainingNfcRetries: result.remainingNfcRetries,
		remainingLivenessRetries: result.remainingLivenessRetries,
	};
}

export function sendCheckResultAndMaybeClose(
	context: VerifySocketContext,
	checkResult: VerifyServerCheckResult,
): void {
	context.transport.sendCheckResult(checkResult);
	if (!checkResult.retryAllowed) {
		context.transport.closeAfterCheckResult(checkResult.reasonCode);
	}
}

export function confirmedCheckResult(): VerifyServerCheckResult {
	return {
		outcome: "confirmed",
		reasonCode: "",
		reasonMessage: "",
		retryAllowed: false,
		failedCheck: "none",
		remainingNfcRetries: MAX_NFC_RETRIES,
		remainingLivenessRetries: MAX_LIVENESS_RETRIES,
	};
}
