export const VERIFY_HANDOFF_COPY = {
  actions: {
    cancel: "Cancel",
    cancelConfirmation:
      "Cancel? This will stop the current verification session.",
    closeThisPage: "Close this page",
    continueNow: "Continue now",
    openKayleIdApp: "Open Kayle ID app",
    tryAgain: "Try again",
  },
  handoff: {
    cancelError: "Unable to cancel the verification session.",
    loadingDescription: "Preparing a secure handoff for your mobile device.",
    loadStatusError: "Unable to load verification status.",
    refreshError: "Unable to generate handoff QR code.",
    waitingDescription: "Waiting for your secure handoff details.",
  },
  screens: {
    connected: {
      headerDescription:
        "Your mobile device is now connected to this verification session.",
      headerTitle: "Continue on your device",
      messageDescription:
        "Finish the remaining steps in the Kayle ID app. This page will update automatically when the session concludes.",
      messageTitle: "Verification is in progress",
    },
    initial: {
      defaultMessageDescription:
        "Scan the QR code with the phone you want to use for verification.",
      headerDescription:
        "This ID check continues in the Kayle ID mobile app.",
      headerTitle: "Open Kayle ID on your phone",
      iosMessageDescription:
        "Open the app directly on this device to continue your verification session.",
      messageTitle: "Use your mobile device to continue",
    },
    retryableFailure: {
      headerDescription:
        "This verification must stay on the mobile device that already started it.",
      headerTitle: "Verification failed",
      messageDescription:
        "The verification did not complete successfully. Retry on that same device, or cancel it there if you want to stop.",
      messageTitle: "Retry on the same device",
    },
    sameDeviceOnly: {
      headerDescription:
        "This verification is reserved for the mobile device that already claimed it.",
      headerTitle: "Continue on your device",
      messageDescription:
        "Open Kayle ID on that same device to continue. A new QR handoff is no longer available for this session.",
      messageTitle: "Waiting for your device",
    },
    terminal: {
      cancelled: {
        description:
          "This verification was cancelled before it could finish.",
        title: "Verification cancelled",
      },
      expired: {
        description:
          "This verification session expired before it could finish.",
        title: "Verification expired",
      },
      failed: {
        description: "The latest verification attempt did not pass.",
        title: "Verification failed",
      },
      finishedHeaderDescription: "This verification session has finished.",
      outcomeMessageTitle: "Verification outcome",
      passportAuthenticityFailed: {
        description:
          "The document integrity checks did not pass for the latest attempt.",
        title: "Verification failed",
      },
      redirectHeaderDescription:
        "You can continue now or wait for the automatic redirect.",
      selfieFaceMismatch: {
        description:
          "The selfie evidence did not match the passport photo on the latest attempt.",
        title: "Verification failed",
      },
      success: {
        description:
          "The verification finished successfully on your mobile device.",
        title: "Verification complete",
      },
      successMessageTitle: "Finished on your mobile device",
      youCanCloseDescription: "You can now close this page.",
    },
  },
} as const;
