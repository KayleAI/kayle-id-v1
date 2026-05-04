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

export interface OrgDeletionCanceledEmailProps {
  cancellerName: string;
  organizationName: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function OrgDeletionCanceledEmail({
  cancellerName,
  organizationName,
}: OrgDeletionCanceledEmailProps) {
  return (
    <Html>
      <Head>
        <title>Organization deletion canceled</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>Deletion of {organizationName} was canceled</Preview>
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
                Deletion canceled
              </Heading>

              <Text className="mb-6 text-center text-neutral-700 text-sm leading-relaxed">
                {cancellerName} canceled the scheduled deletion of{" "}
                <strong>{organizationName}</strong>. The organization is back to
                normal — API keys, webhooks, and verification flows are
                re-enabled.
              </Text>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this because you're an owner or admin of{" "}
                {organizationName}.
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

export default function PreviewOrgDeletionCanceledEmail() {
  return (
    <OrgDeletionCanceledEmail
      cancellerName="Jane Doe"
      organizationName="Acme Inc."
    />
  );
}
