/**
 * English source of truth for shared error-messages. New languages add a
 * matching dictionary under `../<locale>/error-messages.ts` and register it
 * in `../error-messages.ts`.
 */
export const ERROR_MESSAGES = {
  UNKNOWN: {
    title: "Something went wrong",
    description: "We couldn’t complete this check. Try again.",
  },

  INVALID_SESSION_ID: {
    title: "Invalid link",
    description: "This link isn’t valid. Go back and open a new one.",
  },

  SESSION_EXPIRED: {
    title: "Session expired",
    description: "This session has expired. Start again.",
  },

  SESSION_NOT_FOUND: {
    title: "Session not found",
    description: "We can’t find this session. Start again.",
  },

  SESSION_IN_PROGRESS: {
    title: "Already in progress",
    description: "Continue on the device where you started.",
  },

  HELLO_AUTH_REQUIRED: {
    title: "Authentication required",
    description: "This connection is missing credentials. Please try again.",
  },

  ATTEMPT_NOT_FOUND: {
    title: "Session not found",
    description: "This session is no longer available. Start again.",
  },

  HANDOFF_TOKEN_INVALID: {
    title: "Invalid QR code",
    description: "This code isn’t valid. Scan a new one from your browser.",
  },

  HANDOFF_TOKEN_EXPIRED: {
    title: "QR code expired",
    description: "This code has expired. Generate a new one.",
  },

  HANDOFF_TOKEN_CONSUMED: {
    title: "QR code already used",
    description: "Continue on your original device or start again.",
  },

  HANDOFF_DEVICE_MISMATCH: {
    title: "Wrong device",
    description: "Use the device you started with or start again.",
  },

  HELLO_ATTEST_KEY_UNKNOWN: {
    title: "Device not registered",
    description:
      "Your device hasn’t completed setup. Reopen the app to register and try again.",
  },

  HELLO_ATTEST_INVALID: {
    title: "Device check failed",
    description:
      "We couldn’t confirm your device. Reinstall the app or contact support.",
  },

  MIN_APP_VERSION_REQUIRED: {
    title: "Update required",
    description: "Update Kayle ID to the latest version to continue verifying.",
  },

  CANCEL_TOKEN_INVALID: {
    title: "Cannot cancel session",
    description:
      "This session can’t be cancelled from this link. Open the original verify link or contact support.",
  },

  CANCEL_TOKEN_USED: {
    title: "Already cancelled",
    description: "This session has already been cancelled.",
  },

  INVALID_REQUEST: {
    title: "Invalid request",
    description: "The request payload was missing or malformed.",
  },

  ATTEMPT_CONNECTION_ACTIVE: {
    title: "Already open",
    description:
      "This session is active elsewhere. Continue there or try again later.",
  },

  PHASE_OUT_OF_ORDER: {
    title: "Out of order",
    description: "Continue from the current step.",
  },

  NFC_DATA_PHASE_REQUIRED: {
    title: "Not ready yet",
    description: "Scan your document when prompted.",
  },

  DATA_CHUNK_RETRY: {
    title: "Upload failed",
    description: "Retry the upload.",
  },

  NFC_REQUIRED_DATA_MISSING: {
    title: "Document scan incomplete",
    description: "Finish scanning your document to continue.",
  },

  LIVENESS_DATA_PHASE_REQUIRED: {
    title: "Liveness check needed",
    description: "Follow the head-movement prompts to continue.",
  },

  LIVENESS_REQUIRED_DATA_MISSING: {
    title: "Liveness check incomplete",
    description: "Record the head-movement prompts to continue.",
  },

  SHARE_SELECTION_REQUIRED: {
    title: "Select details",
    description: "Choose at least one detail to continue.",
  },

  SHARE_SELECTION_INVALID_FIELD: {
    title: "Invalid selection",
    description:
      "Some selected details aren’t available. Review and try again.",
  },

  SHARE_SELECTION_MISSING_REQUIRED: {
    title: "Required details missing",
    description: "You must keep required details selected.",
  },

  document_authenticity_failed: {
    title: "Document check failed",
    description:
      "We couldn’t verify your document. Try again or use a different one.",
  },

  document_active_authentication_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm your document chip. Try again or use a different one.",
  },

  document_chip_authentication_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm your document chip. Try again or use a different one.",
  },

  document_anti_cloning_attestation_failed: {
    title: "Document check failed",
    description:
      "We couldn’t confirm this scan came from a trusted device. Try again on the same device or contact support.",
  },

  selfie_face_mismatch: {
    title: "Face doesn’t match",
    description: "Your face doesn’t match your document photo. Try again.",
  },

  liveness_failed: {
    title: "Liveness check failed",
    description:
      "We couldn’t confirm the camera was on a live person. Try again and follow the head-movement prompts.",
  },
} as const;
