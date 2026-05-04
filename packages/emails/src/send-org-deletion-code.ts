import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { OrgDeletionCodeEmail } from "../emails/org-deletion-code";

export interface SendOrgDeletionCodeInput {
  binding: SendEmail;
  code: string;
  expiresInMinutes?: number;
  from: string;
  organizationName: string;
  to: string;
}

export async function sendOrgDeletionCode({
  binding,
  code,
  expiresInMinutes = 60 * 24,
  from,
  organizationName,
  to,
}: SendOrgDeletionCodeInput): Promise<void> {
  const element = createElement(OrgDeletionCodeEmail, {
    code,
    expiresInMinutes,
    organizationName,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  try {
    await binding.send({
      from,
      html,
      subject: `Kayle ID — Confirm deletion of ${organizationName}`,
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send org-deletion code email: ${message}`);
  }
}
