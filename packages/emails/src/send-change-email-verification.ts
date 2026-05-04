import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { ChangeEmailVerificationEmail } from "../emails/change-email-verification";

export interface SendChangeEmailVerificationInput {
  binding: SendEmail;
  expiresInMinutes?: number;
  from: string;
  newEmail: string;
  to: string;
  url: string;
}

export async function sendChangeEmailVerification({
  binding,
  expiresInMinutes = 60,
  from,
  newEmail,
  to,
  url,
}: SendChangeEmailVerificationInput): Promise<void> {
  const element = createElement(ChangeEmailVerificationEmail, {
    expiresInMinutes,
    newEmail,
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
      subject: "Kayle ID — Confirm your new email",
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send change-email verification: ${message}`);
  }
}
