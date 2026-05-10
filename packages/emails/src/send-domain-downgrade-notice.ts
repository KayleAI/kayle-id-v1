import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { DomainDowngradeNoticeEmail } from "../emails/domain-downgrade-notice";

export interface SendDomainDowngradeNoticeInput {
  apexDomain: string;
  binding: SendEmail;
  domainsUrl: string;
  from: string;
  organizationName: string;
  recordName: string;
  recordValue: string;
  to: string;
}

export async function sendDomainDowngradeNotice({
  apexDomain,
  binding,
  domainsUrl,
  from,
  organizationName,
  recordName,
  recordValue,
  to,
}: SendDomainDowngradeNoticeInput): Promise<void> {
  const element = createElement(DomainDowngradeNoticeEmail, {
    apexDomain,
    domainsUrl,
    organizationName,
    recordName,
    recordValue,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  try {
    await binding.send({
      from,
      html,
      subject: `Kayle ID — Verification of ${apexDomain} was removed`,
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send domain-downgrade notice email: ${message}`);
  }
}
