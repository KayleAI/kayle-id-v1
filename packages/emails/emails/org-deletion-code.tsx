/** @jsxImportSource react */
import {
  Body,
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

export interface OrgDeletionCodeEmailProps {
  code: string;
  expiresInMinutes: number;
  organizationName: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function OrgDeletionCodeEmail({
  code,
  expiresInMinutes,
  organizationName,
}: OrgDeletionCodeEmailProps) {
  return (
    <Html>
      <Head>
        <title>Confirm organization deletion</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>
        Enter this code to schedule deletion of {organizationName}
      </Preview>
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
                Confirm deletion of {organizationName}
              </Heading>

              <Text className="mb-4 text-center text-neutral-700 text-sm leading-relaxed">
                Enter this code on the organization settings page to schedule
                deletion. After confirmation, the organization is frozen for 48
                hours and then permanently deleted along with all members,
                invitations, API keys, and webhooks.
              </Text>

              <Section className="mb-6 text-center">
                <Text className="m-0 inline-block rounded-md bg-white px-6 py-4 text-center font-mono font-semibold text-2xl text-neutral-950 tracking-[0.4em]">
                  {code}
                </Text>
              </Section>

              <Text className="mb-6 text-center text-neutral-700 text-sm leading-relaxed">
                This code expires in {expiresInMinutes} minutes.
              </Text>

              <Text className="mb-8 text-center font-medium text-neutral-950 text-sm">
                If this wasn't you, ignore this email. Nothing changes until the
                code is entered.
              </Text>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this because a deletion request was made for{" "}
                {organizationName} from a session signed into your account. Any
                other owner or admin can cancel a scheduled deletion before the
                48-hour window ends.
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

export default function PreviewOrgDeletionCodeEmail() {
  return (
    <OrgDeletionCodeEmail
      code="K7P2X9MB"
      expiresInMinutes={60 * 24}
      organizationName="Acme Inc."
    />
  );
}
