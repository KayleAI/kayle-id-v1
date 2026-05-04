import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { DeleteAccountVerificationEmail } from "../emails/delete-account-verification";

export interface SendDeleteAccountVerificationInput {
  binding: SendEmail;
  expiresInMinutes?: number;
  from: string;
  to: string;
  url: string;
}

export async function sendDeleteAccountVerification({
  binding,
  expiresInMinutes = 60 * 24,
  from,
  to,
  url,
}: SendDeleteAccountVerificationInput): Promise<void> {
  const element = createElement(DeleteAccountVerificationEmail, {
    expiresInMinutes,
    url,
  });

  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);

  try {
    await binding.send({
      from,
      html,
      subject: "Kayle ID — Confirm account deletion",
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send delete-account verification: ${message}`);
  }
}
