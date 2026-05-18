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
    cancelOrWithdrawConsent: "Cancel or withdraw consent",
    closeThisPage: "Close this page",
    continueNow: "Continue",
    openKayleIdApp: "Open Kayle ID",
    tryAgain: "Try again",
  },

  cancelDialog: {
    title: "Cancel or withdraw consent?",
    description:
      "This will stop this check and withdraw consent for Kayle ID processing.",
    confirm: "Yes, stop this check",
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
      pageTitle: "Kayle ID Privacy Options",
      pageDescription: "Withdraw consent for a Kayle ID check",
    },
    linkLabel: "My privacy options",
    heading: "Privacy Options",
    statusHeading: "About this ID check",
    terminalHeading: "This check is finished",
    activeDescription:
      "Kayle ID only holds the temporary document and selfie data needed to run this check. Withdrawing consent stops processing and deletes anything still held for it.",
    unavailableActiveDescription:
      "Kayle ID cannot load this check’s organization. Because the check is not finished, Kayle ID may still hold temporary data for it.",
    terminalNoDataDescription:
      "This check is already finished. Kayle ID no longer has your document, selfie, or personal details for it.",
    terminalUndeliveredDescription:
      "This check is already finished. Kayle ID no longer has your document, selfie, or personal details. {organization} has not received the result, and withdrawal can delete the undelivered encrypted result now.",
    terminalDeliveredDescription:
      "This check is already finished. Kayle ID no longer has your document, selfie, or personal details. {organization} has already received your data.",
    notFoundHeading: "We can’t find this ID check",
    notFoundDescription:
      "If this is the check you used, Kayle ID no longer has your document, selfie, or personal details for it.",
    withdrawTitle: "Withdraw consent",
    withdrawDescriptionActive:
      "Kayle ID will stop processing this check and delete anything still held for it.",
    withdrawDescriptionTerminal:
      "Kayle ID will record the withdrawal of your consent and delete any encrypted results we hold for this check.",
    cancelButton: "Withdraw consent",
    cancelPendingButton: "Withdrawing consent...",
    cancelSuccess: "Consent withdrawn",
    cancelError: "We could not withdraw this check from this link.",
    organizationRequestTitle: "Your data was already sent to {organization}",
    organizationRequestDescription:
      "{organization} controls the data they received. Please contact them for access or deletion there.",
    rpEmailButton: "Email {organization}",
    learnMoreLink: "Learn more about Kayle ID",
    defaultOrganizationName: "this organization",
  },

  screens: {
    connected: {
      headerTitle: "Continue on your phone",
      headerDescription: "Your phone is now connected.",
      messageTitle: "ID Check in progress",
      messageDescription: "Continue the check in the Kayle ID app.",
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
        title: "Check cancelled",
        headerDescription: "Kayle ID will not continue this check.",
        messageTitle: "No further action needed",
        description: "This check was stopped.",
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
        title: "ID Check Complete",
        description: "The ID Check was successfully completed on your phone.",
      },

      finishedHeaderDescription: "This ID Check is complete.",
      unfinishedHeaderDescription: "This ID Check did not complete.",
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
        "Shares only the Kayle ID check result and details you choose to share with ",
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
        "I allow Kayle ID to share the verification result and details I choose to share with ",
      bulletShareFullSuffix: "",
      bulletShareAgeOnlyPrefix: "I allow Kayle ID to share ",
      bulletShareAgeOnlyEmphasis: "only",
      bulletShareAgeOnlyMiddle: " whether I am {ageLabel} with ",
      bulletShareAgeOnlySuffix: " — no other details",

      agreementPrefix: "I agree to the ",
      agreementMiddle: " and ",
      agreementSuffix: " and consent to this verification.",
      termsOfServiceLink: "Terms of Service",
      privacyNoticeLink: "Privacy Notice",

      startButtonFull: "Start verification",
      startButtonAgeOnly: "Confirm my age",
      startButtonPending: "Starting...",
      declineButton: "I do not consent",
      submitError:
        "We couldn’t record your consent. Check your connection and try again.",
      refusalDialogTitle: "Do not consent?",
      refusalDialogDescriptionPrefix: "This will stop this check. Contact ",
      refusalDialogDescriptionSuffix:
        " to use another route or request review.",
      refusalDialogConfirm: "Yes, stop this check",
      refusalDialogDismiss: "Go back",
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
      "A verified owner has completed Kayle ID's owner identity check.",
    ownerNotVerifiedTitle: "Owner ID check not completed",
    ownerNotVerifiedDescription:
      "Kayle ID has not independently verified the people running this organization. Only continue if you trust this request.",
  },
} as const;
