import type { SendEmail } from "@cloudflare/workers-types";
import { render } from "@react-email/render";
import { createElement } from "react";
import { MagicLinkEmail, type MagicLinkEmailType } from "../emails/magic-link";

export interface SendMagicLinkEmailInput {
  binding: SendEmail;
  expiresInMinutes?: number;
  from: string;
  otp: string;
  to: string;
  type: MagicLinkEmailType;
  url: string;
}

export async function sendMagicLinkEmail({
  binding,
  expiresInMinutes = 15,
  from,
  otp,
  to,
  url,
}: SendMagicLinkEmailInput): Promise<void> {
  const element = createElement(MagicLinkEmail, {
    expiresInMinutes,
    otp,
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
      subject: "Kayle ID — Sign in to your account",
      text,
      to,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown email send error";
    throw new Error(`Failed to send magic link email: ${message}`);
  }
}
