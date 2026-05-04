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

export interface DeleteAccountVerificationEmailProps {
  expiresInMinutes: number;
  url: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function DeleteAccountVerificationEmail({
  expiresInMinutes,
  url,
}: DeleteAccountVerificationEmailProps) {
  return (
    <Html>
      <Head>
        <title>Confirm Kayle ID account deletion</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>Confirm permanent deletion of your Kayle ID account</Preview>
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
                Confirm account deletion
              </Heading>

              <Text className="mb-4 text-center text-neutral-700 text-sm leading-relaxed">
                Click the button below to permanently delete your Kayle ID
                account. This action cannot be undone. Any organizations you
                solely own will also be deleted, along with their API keys,
                webhooks, and members.
              </Text>

              <Text className="mb-6 text-center text-neutral-700 text-sm leading-relaxed">
                This link will expire in {expiresInMinutes} minutes.
              </Text>

              <Text className="mb-8 text-center font-medium text-neutral-950 text-sm">
                If this wasn't you, ignore this email and your account will not
                be deleted.
              </Text>

              <Section className="mb-8 text-center">
                <Button
                  className="rounded-full bg-red-600 px-12 py-3 font-medium text-sm text-white"
                  href={url}
                >
                  Permanently delete my account
                </Button>
              </Section>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this email because a deletion request was made
                from a session signed into this account. If this wasn't you,
                please sign in and revoke any unfamiliar sessions on the
                Security page.
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

export default function PreviewDeleteAccountVerificationEmail() {
  return (
    <DeleteAccountVerificationEmail
      expiresInMinutes={60 * 24}
      url="https://kayle.id/api/auth/delete-user/callback?token=preview-token"
    />
  );
}
