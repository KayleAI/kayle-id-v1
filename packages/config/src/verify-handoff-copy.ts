export const VERIFY_HANDOFF_COPY = {
  actions: {
    cancel: "Cancel",
    cancelConfirmation: "Cancel? This will stop this check.",
    closeThisPage: "Close this page",
    continueNow: "Continue",
    openKayleIdApp: "Open Kayle ID",
    tryAgain: "Try again",
  },

  handoff: {
    cancelError: "Unable to cancel.",
    loadingDescription: "Preparing a secure connection for your phone.",
    loadStatusError: "Unable to load status.",
    refreshError: "Unable to generate QR code.",
    waitingDescription: "Waiting for connection details.",
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
  },
} as const;
