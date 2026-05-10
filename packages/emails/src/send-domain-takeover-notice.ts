import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { DomainTakeoverNoticeEmail } from "../emails/domain-takeover-notice";

export interface SendDomainTakeoverNoticeInput {
  apexDomain: string;
  binding: SendEmail;
  domainsUrl: string;
  from: string;
  organizationName: string;
  takingOverOrganizationName: string;
  to: string;
}

export async function sendDomainTakeoverNotice({
  apexDomain,
  binding,
  domainsUrl,
  from,
  organizationName,
  takingOverOrganizationName,
  to,
}: SendDomainTakeoverNoticeInput): Promise<void> {
  const element = createElement(DomainTakeoverNoticeEmail, {
    apexDomain,
    domainsUrl,
    organizationName,
    takingOverOrganizationName,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  try {
    await binding.send({
      from,
      html,
      subject: `Kayle ID — Verification of ${apexDomain} was transferred`,
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send domain-takeover notice email: ${message}`);
  }
}
