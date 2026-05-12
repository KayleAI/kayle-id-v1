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
        "It didn’t complete successfully. Retry on the same device, or cancel it there.",
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
        title: "Failed",
        description: "The latest attempt didn’t pass.",
      },

      documentAuthenticityFailed: {
        title: "Document check failed",
        description: "We couldn’t verify your document.",
      },

      documentActiveAuthenticationFailed: {
        title: "Document check failed",
        description: "We couldn’t confirm your document chip.",
      },

      documentChipAuthenticationFailed: {
        title: "Document check failed",
        description: "We couldn’t confirm your document chip.",
      },

      selfieFaceMismatch: {
        title: "Face doesn’t match",
        description: "Your selfie doesn’t match your document photo.",
      },

      success: {
        title: "Complete",
        description: "Finished successfully on your phone.",
      },

      finishedHeaderDescription: "This check is complete.",
      outcomeMessageTitle: "Result",
      redirectHeaderDescription: "Continue now or wait to be redirected.",
      successMessageTitle: "Finished on your phone",
      youCanCloseDescription: "You can close this page.",
    },

    explain: {
      headline: "Verify your identity with Kayle ID",
      intro:
        "Kayle ID lets you verify your identity using your document's chip and a selfie.",
      processTitle: "This process:",
      processBulletAuthentic: "Confirms that your document is genuine",
      processBulletHolder: "Confirms that you are the document holder",
      processBulletSharingPrefix:
        "Shares only the verification result and details you choose to share with ",
      processBulletSharingSuffix: "",
      kayleIdTitle: "Kayle ID:",
      kayleIdBulletNoStorage: "Does not store your document or selfie",
      kayleIdBulletNoAccount: "Does not create an account for you",
      kayleIdBulletSessionScoped:
        "Processes data only for this verification session",
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
      agreementSuffix: " and consent to identity verification.",
      termsOfServiceLink: "Terms of Service",
      privacyNoticeLink: "Privacy Notice",

      startButtonFull: "Start verification",
      startButtonAgeOnly: "Confirm my age",
      backButton: "Back",
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
