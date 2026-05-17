/**
 * English source of truth for the verify-handoff copy. New languages add a
 * matching dictionary under `../<locale>/verify-handoff-copy.ts` and register
 * it in `../verify-handoff-copy.ts`.
 */
export const VERIFY_HANDOFF_COPY = {
  head: {
    pageTitle: "Kayle ID Verification",
    pageDescription: "Verify your identity with Kayle ID",
  },

  actions: {
    cancel: "Cancel",
    closeThisPage: "Close this page",
    continueNow: "Continue",
    openKayleIdApp: "Open Kayle ID",
    tryAgain: "Try again",
  },

  cancelDialog: {
    title: "Cancel this check?",
    description: "This will stop the check. You can start a new one later.",
    confirm: "Yes, cancel",
    dismiss: "Keep going",
  },

  handoff: {
    cancelError: "Unable to cancel.",
    loadStatusError: "Unable to load status.",
    refreshError: "Unable to generate QR code.",
    errorMessageTitle: "Unable to generate QR code",
    errorMessageDescription: "Check your internet connection and try again.",
  },

  rpFallback: {
    title: "Need another route?",
    description:
      "Use one of this organization's fallback options if Kayle ID is not the right way to complete this check.",
    fallbackIdvLabel: "Use another verification method",
    appealLabel: "Request review",
    contactLabel: "Contact {organization}",
    complaintsLabel: "Complaints",
  },

  privacyRequest: {
    head: {
      pageTitle: "Kayle ID Privacy Requests",
      pageDescription:
        "Withdraw consent or request data access and deletion for a Kayle ID check",
    },
    linkLabel: "Withdraw this check",
    heading: "Privacy requests for this check",
    description:
      "Kayle can stop Kayle-side processing for this check. For data already received by the organization, contact the organization directly. You do not need a Kayle account.",
    scopeTitle: "Reference for this request",
    scopeDescription:
      "Include this reference so Kayle ID can find the session without asking you to create an account.",
    sessionIdLabel: "Session ID",
    attemptIdLabel: "Latest attempt ID",
    attemptUnavailable: "Not available yet",
    organizationLabel: "Organization",
    withdrawTitle: "Withdraw this check",
    withdrawDescriptionWithToken:
      "This link includes the session cancellation token, so Kayle can stop pending processing and scrub undelivered payloads where possible.",
    withdrawDescriptionWithoutToken:
      "This link does not include a cancellation token. You can still send a privacy request using the session reference below.",
    cancelButton: "Withdraw this check",
    cancelPendingButton: "Withdrawing...",
    cancelSuccess:
      "Kayle has recorded this request and stopped Kayle-side processing where possible.",
    cancelError: "We could not withdraw this check from this link.",
    requestTitle: "Request deletion or data access",
    requestDescription:
      "Use these prefilled email links for deletion, withdrawal, or data access requests. The message includes the session reference.",
    kayleEmailButton: "Email Kayle privacy team",
    rpEmailButton: "Email {organization}",
    loading: "Loading session reference...",
    loadError:
      "We could not load the full session reference, but the session ID in the URL can still be used for a request.",
  },

  screens: {
    connected: {
      headerTitle: "Continue on your phone",
      headerDescription: "Your phone is now connected.",
      messageTitle: "In progress",
      messageDescription:
        "Finish the steps in the Kayle ID app. This page will update automatically.",
    },

    initial: {
      headerTitle: "Open Kayle ID on your phone",
      headerDescription: "This check continues in the Kayle ID app.",
      messageTitle: "Use your phone to continue",
      defaultMessageDescription:
        "Scan the QR code with the phone you want to use.",
      iosMessageDescription: "Open the app on this device to continue.",
    },

    retryableFailure: {
      headerTitle: "Try again on your phone",
      headerDescription: "This check must stay on the device that started it.",
      messageTitle: "Try again",
      messageDescription:
        "Kayle ID could not automatically confirm this check. Retry on the same device, or cancel it there.",
    },

    sameDeviceOnly: {
      headerTitle: "Continue on your phone",
      headerDescription: "This check is locked to the device that started it.",
      messageTitle: "Waiting for your device",
      messageDescription:
        "Open Kayle ID on that device to continue. A new QR code isn’t available.",
    },

    terminal: {
      cancelled: {
        title: "Cancelled",
        description: "This check was cancelled before it finished.",
      },

      expired: {
        title: "Expired",
        description: "This check expired before it finished.",
      },

      failed: {
        title: "Check not confirmed",
        description:
          "Kayle ID could not automatically confirm the latest attempt.",
      },

      documentAuthenticityFailed: {
        title: "Document check not confirmed",
        description: "Kayle ID could not automatically confirm your document.",
      },

      documentActiveAuthenticationFailed: {
        title: "Document check not confirmed",
        description: "We couldn’t confirm your document chip.",
      },

      documentChipAuthenticationFailed: {
        title: "Document check not confirmed",
        description: "We couldn’t confirm your document chip.",
      },

      selfieFaceMismatch: {
        title: "Face match not confirmed",
        description:
          "Kayle ID could not automatically confirm that your selfie matched the document photo.",
      },

      success: {
        title: "Kayle check complete",
        description: "The Kayle check completed on your phone.",
      },

      finishedHeaderDescription: "This check is complete.",
      outcomeMessageTitle: "Result",
      redirectHeaderDescription: "Continue now or wait to be redirected.",
      successMessageTitle: "Finished on your phone",
      youCanCloseDescription: "You can close this page.",
    },

    explain: {
      headline: "Complete a Kayle ID check",
      intro:
        "Kayle ID processes an identity-assurance check using your document's chip and a selfie.",
      processTitle: "This process:",
      processBulletAuthentic: "Checks whether your document is genuine",
      processBulletHolder: "Checks whether you are the document holder",
      processBulletSharingPrefix:
        "Shares only the Kayle check result and details you choose to share with ",
      processBulletSharingSuffix: "",
      processBulletDecisionPrefix: "Sends an identity-assurance signal to ",
      processBulletDecisionSuffix:
        "; that organization decides what to do with the result.",
      kayleIdTitle: "Kayle ID:",
      kayleIdBulletNoStorage: "Does not store your document or selfie",
      kayleIdBulletNoAccount: "Does not create an account for you",
      kayleIdBulletSessionScoped:
        "Processes document and biometric data only for this check, then discards it when the secure connection closes",
      kayleIdBulletRetention:
        "Keeps limited session metadata for bounded retention periods described in the Privacy Notice",
      kayleIdBulletNoDecision:
        "Does not decide whether you receive the organization's service",
      continueButton: "Continue",

      ageOnly: {
        headlineWithThreshold: "Confirm you're over {threshold}",
        headlineGeneric: "Confirm your age",
        ageLabelWithThreshold: "over {threshold}",
        ageLabelGeneric: "old enough",
        introPrefix: "",
        introSuffix:
          " only needs to know whether you're {ageLabel} — not your name, date of birth, or any other personal details. Kayle ID lets you prove that privately, using your document and a selfie.",
        whatGetsSharedTitle: "What gets shared:",
        yesNoBulletPrefix: "A single yes-or-no answer: ",
        yesNoBulletQuestion: "are you {ageLabel}?",
        nothingElseBullet:
          "Nothing else — not your name, date of birth, document number, nationality, or photo",
      },
    },

    consent: {
      heading: "Your consent is required",
      subheadingFull: "To continue, you must agree to the following:",
      subheadingAgeOnly: "To prove your age, you must agree to the following:",

      bulletReadDocFull: "I allow Kayle ID to read data from my document",
      bulletReadDocAgeOnly:
        "I allow Kayle ID to read my document to check my age",
      bulletSelfie:
        "I allow Kayle ID to capture a selfie to confirm I am the document holder",
      bulletShareFullPrefix:
        "I allow Kayle ID to share the Kayle check result and details I choose to share with ",
      bulletShareFullSuffix: "",
      bulletShareAgeOnlyPrefix: "I allow Kayle ID to share ",
      bulletShareAgeOnlyEmphasis: "only",
      bulletShareAgeOnlyMiddle: " whether I am {ageLabel} with ",
      bulletShareAgeOnlySuffix: " — no other details",

      claimManifestTitle: "Details requested",
      claimManifestDescription:
        "Review what this organization is asking Kayle ID to check or share before anything is read from your document.",
      requiredClaimsTitle: "Required details",
      requiredClaimsDescription:
        "These must stay selected for this check to continue.",
      optionalClaimsTitle: "Optional details",
      optionalClaimsDescription:
        "You can choose whether to share these later in the Kayle ID app.",
      securityClaimsTitle: "Security checks",
      securityClaimsDescription:
        "Kayle ID uses these to prevent duplicate or replayed document checks.",
      ageOnlyClaimsTitle: "Age-only result",
      ageOnlyClaimsDescription:
        "Only a yes-or-no age answer is shared for this part of the check.",
      requiredBadge: "Required",
      optionalBadge: "Optional",

      documentProcessingConsentFull:
        "I consent to Kayle ID reading my document data for this check.",
      documentProcessingConsentAgeOnly:
        "I consent to Kayle ID reading my document data to check my age.",
      biometricConsent:
        "I consent to Kayle ID capturing and processing my selfie to confirm I am the document holder.",
      shareClaimsConsentFull:
        "I consent to Kayle ID sharing the selected check result and details with {organization}.",
      shareClaimsConsentAgeOnly:
        "I consent to Kayle ID sharing only whether I am {ageLabel} with {organization}.",
      termsAcknowledgementPrefix: "I agree to the ",
      termsAcknowledgementSuffix: ".",
      privacyAcknowledgementPrefix: "I have read the ",
      privacyAcknowledgementSuffix: ".",

      agreementPrefix: "I agree to the ",
      agreementMiddle: " and ",
      agreementSuffix: " and consent to identity verification.",
      termsOfServiceLink: "Terms of Service",
      privacyNoticeLink: "Privacy Notice",

      startButtonFull: "Start verification",
      startButtonAgeOnly: "Confirm my age",
      startButtonPending: "Starting...",
      declineButton: "I do not consent",
      backButton: "Back",
      submitError:
        "We couldn’t record your consent. Check your connection and try again.",
      refusalCancelError:
        "We couldn’t cancel the session from this link, but no new Kayle ID processing will start from this page.",
      refusalHeading: "Check stopped",
      refusalDescription:
        "Kayle ID will not continue this check. Contact {organization} to use another route or request review.",
      refusalContactButton: "Contact {organization}",
      refusalBackButton: "Review the notice again",
      defaultRpName: "this organization",
    },

    notFound: {
      headerTitle: "Page Not Found",
      headerDescription: "The page you are looking for does not exist.",
      messageTitle: "We couldn't find the page you were looking for",
      messageDescription: "Please check the URL you followed and try again.",
      goBackButton: "Go back to the previous page",
    },

    sessionError: {
      headerTitle: "Session Error",
      headerDescription: "An error occurred while loading the session.",
    },
  },

  org: {
    aboutDialogTitle: "About {name}",
    aboutDialogDescription:
      "To help protect you, we're showing you some information about the organization requesting this check.",

    soleTraderNameLabel: "Full name",
    soleTraderJurisdictionLabel: "Country",
    soleTraderRegistrationLabel: "Tax / trader ID",
    businessNameLabel: "Legal name",
    businessJurisdictionLabel: "Registered in",
    businessRegistrationLabel: "Registration number",

    websiteLinkLabel: "Website",
    privacyPolicyLinkLabel: "Privacy policy",
    termsOfServiceLinkLabel: "Terms of service",
    opensInNewTabLabel: "Opens in a new tab",

    verifiedDomainTitleSingular: "Verified domain",
    verifiedDomainTitlePlural: "Verified domains",
    verifiedDomainDescriptionSingular:
      "Kayle ID confirmed control of this domain. The website and policy links shown here all point to it.",
    verifiedDomainDescriptionPlural:
      "Kayle ID confirmed control of these domains. The website and policy links shown here all point to them.",

    ownerVerifiedTitle: "Owner ID check completed",
    ownerVerifiedDescription:
      "The people running this organization have completed Kayle ID's owner identity check.",
    ownerNotVerifiedTitle: "Owner ID check not completed",
    ownerNotVerifiedDescription:
      "Kayle ID has not independently verified the people running this organization. Only continue if you trust this request.",
  },
} as const;
