import { expect, test } from "vitest";
import { getDemoWebhookReceiptId } from "@/demo/webhook-history";
import { buildDemoAttemptViews, isDemoRunSettled } from "./demo-attempts";

function createWebhook({
  deliveryId,
  eventType = "verification.attempt.failed",
  receivedAt,
}: {
  deliveryId: string;
  eventType?:
    | "verification.attempt.failed"
    | "verification.attempt.succeeded"
    | "verification.session.cancelled"
    | "verification.session.expired";
  receivedAt: string;
}) {
  return {
    body: deliveryId,
    delivery_id: deliveryId,
    event_type: eventType,
    received_at: receivedAt,
    signature_header: `sig_${deliveryId}`,
  } as const;
}

test("buildDemoAttemptViews keeps attempts ordered while deduplicating redeliveries", () => {
  const firstAttempt = createWebhook({
    deliveryId: "whd_attempt_1_first",
    receivedAt: "2026-04-19T10:00:00.000Z",
  });
  const firstAttemptRedelivery = createWebhook({
    deliveryId: "whd_attempt_1_second",
    receivedAt: "2026-04-19T10:00:05.000Z",
  });
  const secondAttempt = createWebhook({
    deliveryId: "whd_attempt_2",
    eventType: "verification.attempt.succeeded",
    receivedAt: "2026-04-19T10:03:00.000Z",
  });

  const attempts = buildDemoAttemptViews({
    processedWebhooks: {
      [getDemoWebhookReceiptId(firstAttempt)]: {
        decryptedPayload: JSON.stringify({
          type: "verification.attempt.failed",
          data: {
            failure_code: "selfie_mismatch",
          },
          metadata: {
            verification_attempt_id: "va_1",
          },
        }),
        error: null,
        status: "decrypted",
      },
      [getDemoWebhookReceiptId(firstAttemptRedelivery)]: {
        decryptedPayload: JSON.stringify({
          type: "verification.attempt.failed",
          data: {
            failure_code: "selfie_mismatch",
          },
          metadata: {
            verification_attempt_id: "va_1",
          },
        }),
        error: null,
        status: "decrypted",
      },
      [getDemoWebhookReceiptId(secondAttempt)]: {
        decryptedPayload: JSON.stringify({
          type: "verification.attempt.succeeded",
          data: {
            claims: {
              family_name: "DOE",
            },
          },
          metadata: {
            verification_attempt_id: "va_2",
          },
        }),
        error: null,
        status: "decrypted",
      },
    },
    webhooks: [firstAttempt, firstAttemptRedelivery, secondAttempt],
  });

  expect(attempts).toHaveLength(2);
  expect(attempts.map((attempt) => attempt.id)).toEqual(["va_1", "va_2"]);
  expect(attempts[0]?.receiptId).toBe(
    getDemoWebhookReceiptId(firstAttemptRedelivery)
  );
  expect(attempts[1]?.eventPreview?.eventType).toBe(
    "verification.attempt.succeeded"
  );
});

test("buildDemoAttemptViews falls back to the receipt id before payload metadata is available", () => {
  const pendingAttempt = createWebhook({
    deliveryId: "whd_pending_attempt",
    receivedAt: "2026-04-19T10:04:00.000Z",
  });

  const attempts = buildDemoAttemptViews({
    processedWebhooks: {
      [getDemoWebhookReceiptId(pendingAttempt)]: {
        decryptedPayload: null,
        error: null,
        status: "verified",
      },
    },
    webhooks: [pendingAttempt],
  });

  expect(attempts).toHaveLength(1);
  expect(attempts[0]?.id).toBe(getDemoWebhookReceiptId(pendingAttempt));
  expect(attempts[0]?.eventPreview).toBeNull();
});

test("isDemoRunSettled waits for the terminal webhook of the latest attempt", () => {
  const firstAttempt = createWebhook({
    deliveryId: "whd_attempt_1",
    receivedAt: "2026-04-19T10:00:00.000Z",
  });
  const secondAttempt = createWebhook({
    deliveryId: "whd_attempt_2",
    eventType: "verification.attempt.succeeded",
    receivedAt: "2026-04-19T10:03:00.000Z",
  });
  const sessionStatus = {
    completed_at: "2026-04-19T10:03:00.000Z",
    is_terminal: true,
    latest_attempt: {
      completed_at: "2026-04-19T10:03:00.000Z",
      failure_code: null,
      id: "va_2",
      status: "succeeded" as const,
    },
    redirect_url: null,
    session_id: "vs_demo_test",
    status: "completed" as const,
  };

  expect(
    isDemoRunSettled({
      processedWebhooks: {
        [getDemoWebhookReceiptId(firstAttempt)]: {
          decryptedPayload: JSON.stringify({
            type: "verification.attempt.failed",
            data: {
              failure_code: "selfie_mismatch",
            },
            metadata: {
              verification_session_id: "vs_demo_test",
              verification_attempt_id: "va_1",
            },
          }),
          error: null,
          status: "decrypted",
        },
      },
      sessionStatus,
      webhooks: [firstAttempt],
    })
  ).toBe(false);

  expect(
    isDemoRunSettled({
      processedWebhooks: {
        [getDemoWebhookReceiptId(firstAttempt)]: {
          decryptedPayload: JSON.stringify({
            type: "verification.attempt.failed",
            data: {
              failure_code: "selfie_mismatch",
            },
            metadata: {
              verification_session_id: "vs_demo_test",
              verification_attempt_id: "va_1",
            },
          }),
          error: null,
          status: "decrypted",
        },
        [getDemoWebhookReceiptId(secondAttempt)]: {
          decryptedPayload: JSON.stringify({
            type: "verification.attempt.succeeded",
            data: {
              claims: {
                family_name: "DOE",
              },
            },
            metadata: {
              verification_session_id: "vs_demo_test",
              verification_attempt_id: "va_2",
            },
          }),
          error: null,
          status: "decrypted",
        },
      },
      sessionStatus,
      webhooks: [firstAttempt, secondAttempt],
    })
  ).toBe(true);
});

test("isDemoRunSettled requires a decrypted session-terminal webhook for cancelled and expired runs", () => {
  const terminalWebhook = createWebhook({
    deliveryId: "whd_terminal",
    eventType: "verification.session.cancelled",
    receivedAt: "2026-04-19T10:05:00.000Z",
  });
  const cancelledStatus = {
    completed_at: "2026-04-19T10:05:00.000Z",
    is_terminal: true,
    latest_attempt: {
      completed_at: "2026-04-19T10:05:00.000Z",
      failure_code: null,
      id: "va_terminal",
      status: "cancelled" as const,
    },
    redirect_url: null,
    session_id: "vs_demo_test",
    status: "cancelled" as const,
  };

  expect(
    isDemoRunSettled({
      processedWebhooks: {
        [getDemoWebhookReceiptId(terminalWebhook)]: {
          decryptedPayload: null,
          error: "Webhook signature verification failed.",
          status: "invalid",
        },
      },
      sessionStatus: cancelledStatus,
      webhooks: [terminalWebhook],
    })
  ).toBe(false);

  expect(
    isDemoRunSettled({
      processedWebhooks: {
        [getDemoWebhookReceiptId(terminalWebhook)]: {
          decryptedPayload: JSON.stringify({
            type: "verification.session.cancelled",
            data: {},
            metadata: {
              verification_session_id: "vs_demo_test",
            },
          }),
          error: null,
          status: "decrypted",
        },
      },
      sessionStatus: cancelledStatus,
      webhooks: [terminalWebhook],
    })
  ).toBe(true);
});
