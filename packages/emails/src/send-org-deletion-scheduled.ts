import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { OrgDeletionScheduledEmail } from "../emails/org-deletion-scheduled";

export interface SendOrgDeletionScheduledInput {
  binding: SendEmail;
  cancelUrl: string;
  deadlineLabel: string;
  from: string;
  organizationName: string;
  requesterName: string;
  to: string;
}

export async function sendOrgDeletionScheduled({
  binding,
  cancelUrl,
  deadlineLabel,
  from,
  organizationName,
  requesterName,
  to,
}: SendOrgDeletionScheduledInput): Promise<void> {
  const element = createElement(OrgDeletionScheduledEmail, {
    cancelUrl,
    deadlineLabel,
    organizationName,
    requesterName,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  try {
    await binding.send({
      from,
      html,
      subject: `Kayle ID — ${organizationName} scheduled for deletion`,
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send org-deletion scheduled email: ${message}`);
  }
}
