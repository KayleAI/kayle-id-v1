import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { VerifyEmailEmail } from "../emails/verify-email";

export interface SendVerifyEmailInput {
  binding: SendEmail;
  email: string;
  expiresInMinutes?: number;
  from: string;
  to: string;
  url: string;
}

export async function sendVerifyEmail({
  binding,
  email,
  expiresInMinutes = 60,
  from,
  to,
  url,
}: SendVerifyEmailInput): Promise<void> {
  const element = createElement(VerifyEmailEmail, {
    email,
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
      subject: "Kayle ID — Confirm your email",
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send verify-email: ${message}`);
  }
}
