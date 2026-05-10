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

export interface DomainTakeoverNoticeEmailProps {
  apexDomain: string;
  domainsUrl: string;
  organizationName: string;
  takingOverOrganizationName: string;
}

const plainLinkStyle = {
  color: "#a3a3a3",
  textDecoration: "none",
} as const;

export function DomainTakeoverNoticeEmail({
  apexDomain,
  domainsUrl,
  organizationName,
  takingOverOrganizationName,
}: DomainTakeoverNoticeEmailProps) {
  return (
    <Html>
      <Head>
        <title>Domain verification transferred</title>
        <Font fallbackFontFamily="Arial" fontFamily="Inter" />
      </Head>
      <Preview>
        Verification of {apexDomain} for {organizationName} has been removed
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

            <Section className="px-8">
              <Heading className="mb-2 text-center font-medium text-lg text-neutral-950">
                Verification of {apexDomain} was removed
              </Heading>

              <Text className="mb-4 text-center text-neutral-700 text-sm leading-relaxed">
                Another organization on Kayle ID,{" "}
                <strong>{takingOverOrganizationName}</strong>, has just
                completed a DNS verification for <strong>{apexDomain}</strong>.
                To prevent end users from seeing two organizations claiming the
                same domain, Kayle ID has removed the verification from{" "}
                <strong>{organizationName}</strong>.
              </Text>

              <Text className="mb-4 text-neutral-700 text-sm leading-relaxed">
                <strong>Until you re-verify:</strong> the verify flow no longer
                shows your business name, jurisdiction, or logo, and any
                redirect URL targeting {apexDomain} (or a subdomain of it) is
                rejected when creating new sessions.
              </Text>

              <Text className="mb-6 text-neutral-700 text-sm leading-relaxed">
                If you believe this is in error — for example, the other
                organization is impersonating your brand — contact Kayle ID
                support immediately. Otherwise, no action is required.
              </Text>

              <Section className="mb-6 text-center">
                <Button
                  className="rounded-md bg-neutral-900 px-6 py-3 text-center font-medium text-sm text-white"
                  href={domainsUrl}
                >
                  Open Domains
                </Button>
              </Section>
            </Section>

            <Hr className="mx-auto my-0 max-w-xs border-neutral-200" />

            <Section className="border-neutral-200 border-t px-8 pb-8 text-center">
              <Text className="mt-6 mb-4 text-neutral-400 text-xs">
                Sent by Kayle ID
              </Text>
              <Text className="mx-auto mb-4 max-w-sm text-center text-neutral-500 text-xs leading-relaxed">
                You're receiving this because you are an owner of{" "}
                {organizationName} on Kayle ID and the domain verification for{" "}
                {apexDomain} was just transferred to another organization.
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

export default function PreviewDomainTakeoverNoticeEmail() {
  return (
    <DomainTakeoverNoticeEmail
      apexDomain="acme.co"
      domainsUrl="https://kayle.id/organizations/domains"
      organizationName="Acme Inc."
      takingOverOrganizationName="Wells Fargo, N.A."
    />
  );
}
