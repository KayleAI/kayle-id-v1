/** @jsxImportSource react */
import {
  Body,
  Button,
  Column,
  Container,
  Font,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

export interface ChangeEmailVerificationEmailProps {
  expiresInMinutes: number;
  newEmail: string;
  url: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function ChangeEmailVerificationEmail({
  expiresInMinutes,
  newEmail,
  url,
}: ChangeEmailVerificationEmailProps) {
  return (
    <Html>
      <Head>
        <title>Confirm your new Kayle ID email</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>Confirm {newEmail} is your new Kayle ID email</Preview>
      <Tailwind>
        <Body className="bg-white font-sans">
          <Container className="mx-auto my-8 max-w-[500px] bg-neutral-100">
            <Section className="px-8 pt-8 pb-8">
              <Row>
                <Column
                  align="left"
                  style={{ verticalAlign: "middle" }}
                  width="32"
                >
                  <a href="https://kayle.id" style={{ textDecoration: "none" }}>
                    <Img
                      alt="Kayle"
                      height="32"
                      src="https://kayle.id/apple-touch-icon.png"
                      width="32"
                    />
                  </a>
                </Column>
                <Column align="right" style={{ verticalAlign: "middle" }}>
                  <a href="https://kayle.id" style={{ textDecoration: "none" }}>
                    <Text className="m-0 text-right font-medium text-lg text-neutral-950">
                      Kayle Inc.
                    </Text>
                  </a>
                </Column>
              </Row>
            </Section>

            <Section className="max-w-sm px-8 text-center">
              <Heading className="mb-2 text-center font-medium text-lg text-neutral-950">
                Confirm your new email
              </Heading>

              <Text className="mb-6 text-center text-neutral-700 text-sm leading-relaxed">
                Click the button below to confirm that {newEmail} is the new
                email address for your Kayle ID account. The link will expire in{" "}
                {expiresInMinutes} minutes.
              </Text>

              <Text className="mb-8 text-center text-neutral-700 text-sm">
                If you did not request this change, you can safely ignore this
                message — your account email will not be updated.
              </Text>

              <Section className="mb-8 text-center">
                <Button
                  className="rounded-full bg-neutral-200 px-12 py-3 font-medium text-neutral-950 text-sm"
                  href={url}
                >
                  Confirm new email
                </Button>
              </Section>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this email because someone — hopefully you —
                requested to change the email address on a Kayle ID account to
                this address. If this wasn't you, no action is required and the
                link will expire automatically.
              </Text>
              <Text className="mx-auto max-w-xs text-neutral-400 text-xs">
                <a href="https://kayle.id/privacy" style={plainLinkStyle}>
                  Privacy Policy
                </a>
                &nbsp; &nbsp; &nbsp;
                <a href="https://kayle.id/terms" style={plainLinkStyle}>
                  Terms of Service
                </a>
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export default function PreviewChangeEmailVerificationEmail() {
  return (
    <ChangeEmailVerificationEmail
      expiresInMinutes={60}
      newEmail="new@example.com"
      url="https://kayle.id/api/auth/verify-email?token=preview-token"
    />
  );
}
