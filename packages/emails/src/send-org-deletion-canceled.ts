import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { OrgDeletionCanceledEmail } from "../emails/org-deletion-canceled";

export interface SendOrgDeletionCanceledInput {
  binding: SendEmail;
  cancellerName: string;
  from: string;
  organizationName: string;
  to: string;
}

export async function sendOrgDeletionCanceled({
  binding,
  cancellerName,
  from,
  organizationName,
  to,
}: SendOrgDeletionCanceledInput): Promise<void> {
  const element = createElement(OrgDeletionCanceledEmail, {
    cancellerName,
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
      subject: `Kayle ID — ${organizationName} deletion canceled`,
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send org-deletion canceled email: ${message}`);
  }
}
