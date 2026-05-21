export const RP_INTEGRATION_TERMS_VERSION = "2026-05-17";
export const RP_INTEGRATION_TERMS_JURISDICTION = "UK/EU GDPR";

export const RP_INTEGRATION_TERMS_CANONICAL_TEXT = [
  "Kayle ID relying-party integration terms, version 2026-05-17.",
  "Kayle ID provides an identity verification signal and does not decide whether an end-user receives the relying party's service.",
  "The relying party is a separate controller for its own access, onboarding, eligibility, fraud, compliance, and account decisions.",
  "The relying party must present Kayle ID accurately as a signal provider and must not describe a Kayle result as Kayle making the relying party's decision.",
  "The relying party must provide its own privacy notice, lawful basis, special-category condition where applicable, support contact, and user-facing decision information before sending a user into Kayle ID.",
  "Where a Kayle failure, cancellation, timeout, or unavailable device path could affect access, onboarding, eligibility, or a similarly significant decision, the relying party must provide an RP-controlled alternative identity verification path.",
  "Where applicable, the relying party must provide appeal, contestation, or human-review safeguards for decisions made from Kayle ID results, including any safeguards required by Article 22, UK GDPR, EU GDPR, or similar laws.",
  "The relying party remains responsible for decisions it makes from Kayle ID signals, for protecting webhook data it receives, and for complying with laws that apply to its own processing.",
].join("\n");

export const RP_INTEGRATION_TERMS_HASH =
  "sha256:5472d5130ecf957716380ec26d82aac35e1c59fe4ce8cba8337c0b8fec1e261e" as const;
