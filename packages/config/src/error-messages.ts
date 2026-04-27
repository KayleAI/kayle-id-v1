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
    description: "Scan your passport when prompted.",
  },

  DATA_CHUNK_RETRY: {
    title: "Upload failed",
    description: "Retry the upload.",
  },

  NFC_REQUIRED_DATA_MISSING: {
    title: "Passport scan incomplete",
    description: "Finish scanning your passport to continue.",
  },

  SELFIE_DATA_PHASE_REQUIRED: {
    title: "Selfie needed",
    description: "Take a selfie to continue.",
  },

  SELFIE_REQUIRED_DATA_MISSING: {
    title: "Selfie missing",
    description: "Take a selfie to continue.",
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

  passport_authenticity_failed: {
    title: "Passport check failed",
    description:
      "We couldn’t verify your passport. Try again or use a different one.",
  },

  selfie_face_mismatch: {
    title: "Face doesn’t match",
    description: "Your selfie doesn’t match your passport photo. Try again.",
  },
} as const;
