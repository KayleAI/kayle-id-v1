/**
 * English source-of-truth for iOS user-facing strings.
 *
 * Keys mirror the English source string, matching Apple's String Catalog
 * convention. Strings containing `%@` (string interpolation, e.g.
 * `\(documentName)`) or `%lld` (Int interpolation, e.g. `\(count)`) are
 * positional parameters substituted by Swift's `String(format:)`.
 *
 * When you add a `String(localized:)`, `Text("…")`, or
 * `Button("…", role:)` literal in Swift, add it here too and run
 * `bun --cwd packages/translations run gen:ios`.
 */
export const IOS_COPY_EN = {
  "%@ uploaded": "%@ uploaded",
  About: "About",
  "Additional machine-readable document data.":
    "Additional machine-readable document data.",
  "Align the printed code within the box.":
    "Align the printed code within the box.",
  "Almost done…": "Almost done…",
  "An unexpected error occurred.": "An unexpected error occurred.",
  "Authenticating data…": "Authenticating data…",
  "Authenticating with document…": "Authenticating with document…",
  Back: "Back",
  Cancel: "Cancel",
  "Checking verification…": "Checking verification…",
  "Choose at least one verification detail before continuing.":
    "Choose at least one verification detail before continuing.",
  "Choose what to share": "Choose what to share",
  Continue: "Continue",
  "Date of Birth": "Date of Birth",
  "Do you see this symbol?": "Do you see this symbol?",
  "Document Number": "Document Number",
  "Document Photo": "Document Photo",
  "Document Type Code": "Document Type Code",
  "Document read complete.": "Document read complete.",
  Done: "Done",
  "Expiry Date": "Expiry Date",
  "Family Name": "Family Name",
  Female: "Female",
  "Follow the NFC prompt and hold the top of your iPhone against the chip.":
    "Follow the NFC prompt and hold the top of your iPhone against the chip.",
  "Get Started": "Get Started",
  "Given Names": "Given Names",
  "Hold still for a moment": "Hold still for a moment",
  "Hold your iPhone near your document.":
    "Hold your iPhone near your document.",
  "How Kayle ID collects, uses, and protects your information.":
    "How Kayle ID collects, uses, and protects your information.",
  "I don't see it": "I don't see it",
  "If you have another supported %@, you can scan that instead.":
    "If you have another supported %@, you can scan that instead.",
  "Initializing NFC reader...": "Initializing NFC reader...",
  "Invalid MRZ key format. Please scan your document again.":
    "Invalid MRZ key format. Please scan your document again.",
  "Issuing Country Code": "Issuing Country Code",
  "Kayle Document ID": "Kayle Document ID",
  "Kayle Human ID": "Kayle Human ID",
  "Kayle ID": "Kayle ID",
  "Kayle ID needs %@ with the RFID symbol on %@ to continue on iPhone.":
    "Kayle ID needs %@ with the RFID symbol on %@ to continue on iPhone.",
  "Keep this screen open while we finish the secure transfer.":
    "Keep this screen open while we finish the secure transfer.",
  "Keep your iPhone close to your %@.": "Keep your iPhone close to your %@.",
  "Let's read your ID": "Let's read your ID",
  "Let’s verify your identity in a few quick steps.":
    "Let’s verify your identity in a few quick steps.",
  "Look for this symbol on %@.": "Look for this symbol on %@.",
  "MRZ Optional Data": "MRZ Optional Data",
  "Make sure your face is well-lit and clearly visible":
    "Make sure your face is well-lit and clearly visible",
  Male: "Male",
  "Move slowly so the arcs around your face fill up":
    "Move slowly so the arcs around your face fill up",
  "NFC read failed.": "NFC read failed.",
  "Nationality Code": "Nationality Code",
  "Next, a quick liveness check": "Next, a quick liveness check",
  "Optional Details": "Optional Details",
  "Photo securely read from your document chip.":
    "Photo securely read from your document chip.",
  "Point your camera at the QR code on the screen":
    "Point your camera at the QR code on the screen",
  "Position your face in the frame": "Position your face in the frame",
  "Position your face in the frame, then slowly turn your head to the left and right. Make sure your face is well-lit and clearly visible.":
    "Position your face in the frame, then slowly turn your head to the left and right. Make sure your face is well-lit and clearly visible.",
  "Press your document against your device and hold still to read the chip.":
    "Press your document against your device and hold still to read the chip.",
  "Privacy Policy": "Privacy Policy",
  "Reading data groups…": "Reading data groups…",
  "Reconnecting…": "Reconnecting…",
  "Required Details": "Required Details",
  "Required security identifier for this verified document.":
    "Required security identifier for this verified document.",
  "Reserved placeholder for a future human identifier.":
    "Reserved placeholder for a future human identifier.",
  "Retry Verification": "Retry Verification",
  "Scan QR Code": "Scan QR Code",
  "Scan not valid.": "Scan not valid.",
  "Scan the QR code": "Scan the QR code",
  "Scan your document": "Scan your document",
  "Security Details": "Security Details",
  "Sex Marker": "Sex Marker",
  "Share all details": "Share all details",
  "Share all details?": "Share all details?",
  "Shares whether you meet the %lld+ age requirement.":
    "Shares whether you meet the %lld+ age requirement.",
  "Start Again": "Start Again",
  "Start Scanning": "Start Scanning",
  "Stay here": "Stay here",
  "Submitting your selection…": "Submitting your selection…",
  "Submitting...": "Submitting...",
  "Terms for using Kayle ID and its identity verification features.":
    "Terms for using Kayle ID and its identity verification features.",
  "Terms of Service": "Terms of Service",
  "These details are required and will be shared if you continue.":
    "These details are required and will be shared if you continue.",
  "These identifiers are always included to protect services from abuse.":
    "These identifiers are always included to protect services from abuse.",
  "This %@ doesn't appear to support NFC":
    "This %@ doesn't appear to support NFC",
  "This will also select %lld optional details. Required and security details are already included.":
    "This will also select %lld optional details. Required and security details are already included.",
  "This will also select 1 optional detail. Required and security details are already included.":
    "This will also select 1 optional detail. Required and security details are already included.",
  "This will stop the current verification on this device.":
    "This will stop the current verification on this device.",
  "Try Again": "Try Again",
  "Try Another Document": "Try Another Document",
  "Turn your head left and right": "Turn your head left and right",
  Unspecified: "Unspecified",
  "Unexpected NFC completion response from the server.":
    "Unexpected NFC completion response from the server.",
  "Unexpected NFC upload response from the server.":
    "Unexpected NFC upload response from the server.",
  "Unexpected liveness completion response from the server.":
    "Unexpected liveness completion response from the server.",
  "Unexpected liveness upload response from the server.":
    "Unexpected liveness upload response from the server.",
  "Unexpected share selection response from the server.":
    "Unexpected share selection response from the server.",
  "Unexpected verification phase response from the server.":
    "Unexpected verification phase response from the server.",
  "Uploading…": "Uploading…",
  "Uploading your %@ securely": "Uploading your %@ securely",
  "Use your camera to scan the printed code on your document, then read the chip if it has one.":
    "Use your camera to scan the printed code on your document, then read the chip if it has one.",
  "Use your camera to scan the QR code from your browser and begin verification.":
    "Use your camera to scan the QR code from your browser and begin verification.",
  "Verification Complete": "Kayle check complete",
  "Verification Failed": "Kayle check could not be confirmed",
  "Verified from your document.": "Read from your document.",
  "We couldn't use this scan to read the chip. Try scanning again.":
    "We couldn't use this scan to read the chip. Try scanning again.",
  "When you're ready, tap Start Scanning and follow the NFC prompt.":
    "When you're ready, tap Start Scanning and follow the NFC prompt.",
  "Will share that you do not meet the %lld+ age requirement.":
    "Will share that you do not meet the %lld+ age requirement.",
  "Will share that you meet the %lld+ age requirement.":
    "Will share that you meet the %lld+ age requirement.",
  "Yes, I see it": "Yes, I see it",
  "You can optionally choose to share these details.":
    "You can optionally choose to share these details.",
  "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.":
    "Your Kayle check result has been securely sent. You can now close this app and return to your browser.",

  // Document-name nouns. Substituted into otherwise-localized parent
  // strings (e.g. "Look for this symbol on %@.") so they MUST be
  // localized too — otherwise French users get English nouns spliced
  // into French sentences.
  "a document": "a document",
  "a passport": "a passport",
  "a residence permit": "a residence permit",
  "an ID card": "an ID card",
  document: "document",
  "document chip": "document chip",
  "ID card": "ID card",
  "ID card chip": "ID card chip",
  passport: "passport",
  "passport chip": "passport chip",
  "residence permit": "residence permit",
  "residence permit chip": "residence permit chip",
  "your document": "your document",
  "your ID card": "your ID card",
  "your passport": "your passport",
  "your residence permit": "your residence permit",

  // VerificationError / LivenessError descriptions.
  "Connection to the verification session was lost. Start again from the beginning.":
    "Connection to the verification session was lost. Start again from the beginning.",
  "Could not read the recorded video. Please try again.":
    "Could not read the recorded video. Please try again.",
  "Failed to encrypt data.": "Failed to encrypt data.",
  "Failed to upload data. Please try again.":
    "Failed to upload data. Please try again.",
  "Failed to upload the liveness recording. Please try again.":
    "Failed to upload the liveness recording. Please try again.",
  "Liveness recording failed. Please try again.":
    "Liveness recording failed. Please try again.",
  "Missing %@ from NFC read. Please scan your %@ again.":
    "Missing %@ from NFC read. Please scan your %@ again.",
  "Retry could not start. %@": "Retry could not start. %@",
  "Session not initialized. Please scan a QR code.":
    "Session not initialized. Please scan a QR code.",
  "The recorded liveness video was empty. Please try again.":
    "The recorded liveness video was empty. Please try again.",

  // DocumentNFCReader.status / VerificationSession.nfcUploadStatusMessage.
  "BAC failed.": "BAC failed.",
  "BAC succeeded.": "BAC succeeded.",
  "Document detected.": "Document detected.",
  Idle: "Idle",
  "PACE failed, falling back to BAC…": "PACE failed, falling back to BAC…",
  "PACE succeeded.": "PACE succeeded.",
  "Performing BAC authentication…": "Performing BAC authentication…",
  "Performing PACE authentication…": "Performing PACE authentication…",
  "Preparing secure upload…": "Preparing secure upload…",
  "Reading Card Access…": "Reading Card Access…",
  "Reconnecting to continue secure upload…":
    "Reconnecting to continue secure upload…",
  "Waiting for secure verification…": "Waiting for secure verification…",
} as const;

export type IosCopyKey = keyof typeof IOS_COPY_EN;
export type IosCopy = Record<IosCopyKey, string>;
