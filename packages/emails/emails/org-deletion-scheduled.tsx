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

export interface OrgDeletionScheduledEmailProps {
  cancelUrl: string;
  deadlineLabel: string;
  organizationName: string;
  requesterName: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function OrgDeletionScheduledEmail({
  cancelUrl,
  deadlineLabel,
  organizationName,
  requesterName,
}: OrgDeletionScheduledEmailProps) {
  return (
    <Html>
      <Head>
        <title>Organization scheduled for deletion</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>
        {organizationName} will be permanently deleted at {deadlineLabel}
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
                {organizationName} is scheduled for deletion
              </Heading>

              <Text className="mb-4 text-center text-neutral-700 text-sm leading-relaxed">
                {requesterName} confirmed deletion of{" "}
                <strong>{organizationName}</strong>. The organization is frozen
                starting now and will be permanently deleted at{" "}
                <strong>{deadlineLabel}</strong>, along with all members,
                invitations, API keys, and webhooks.
              </Text>

              <Text className="mb-6 text-center text-neutral-700 text-sm leading-relaxed">
                Any owner or admin can cancel before the deadline.
              </Text>

              <Section className="mb-8 text-center">
                <Button
                  className="rounded-full bg-red-600 px-12 py-3 font-medium text-sm text-white"
                  href={cancelUrl}
                >
                  Cancel deletion
                </Button>
              </Section>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this because you're an owner or admin of{" "}
                {organizationName}. Once the 48-hour window elapses, deletion
                cannot be undone.
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

export default function PreviewOrgDeletionScheduledEmail() {
  return (
    <OrgDeletionScheduledEmail
      cancelUrl="https://kayle.id/organizations/acme-inc/settings"
      deadlineLabel="Wed, May 7 2026 at 14:30 UTC"
      organizationName="Acme Inc."
      requesterName="Jane Doe"
    />
  );
}
