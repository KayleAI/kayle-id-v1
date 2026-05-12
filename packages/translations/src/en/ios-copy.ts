/**
 * English source-of-truth for iOS user-facing strings.
 *
 * Keys mirror the English source string, matching Apple's String Catalog
 * convention. Strings containing `%@` are positional parameters substituted
 * by Swift's `String(format:)` (Swift's string-interpolation literals like
 * `String(localized: "… \(name) …")` collapse to `"… %@ …"` at the catalog
 * key boundary, so the catalog key always uses `%@`).
 *
 * When you add a `String(localized:)`, `Text("…")`, or
 * `Button("…", role:)` literal in Swift, add it here too and run
 * `bun --cwd packages/translations run gen:ios`.
 */
export const IOS_COPY_EN = {
  "%@ uploaded": "%@ uploaded",
  About: "About",
  "Align the printed code within the box.":
    "Align the printed code within the box.",
  "An unexpected error occurred.": "An unexpected error occurred.",
  "Authenticating data…": "Authenticating data…",
  "Authenticating with document…": "Authenticating with document…",
  Back: "Back",
  Cancel: "Cancel",
  "Checking verification…": "Checking verification…",
  "Choose what to share": "Choose what to share",
  Continue: "Continue",
  "Do you see this symbol?": "Do you see this symbol?",
  "Document read complete.": "Document read complete.",
  Done: "Done",
  "Follow the NFC prompt and hold the top of your iPhone against the chip.":
    "Follow the NFC prompt and hold the top of your iPhone against the chip.",
  "Get Started": "Get Started",
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
  "NFC read failed.": "NFC read failed.",
  "Next, take a quick selfie": "Next, take a quick selfie",
  "Point your camera at the QR code on the screen":
    "Point your camera at the QR code on the screen",
  "Press your document against your device and hold still to read the chip.":
    "Press your document against your device and hold still to read the chip.",
  "Privacy Policy": "Privacy Policy",
  "Reading data groups…": "Reading data groups…",
  "Reconnecting…": "Reconnecting…",
  "Retry Verification": "Retry Verification",
  "Scan QR Code": "Scan QR Code",
  "Scan not valid.": "Scan not valid.",
  "Scan the QR code": "Scan the QR code",
  "Scan your document": "Scan your document",
  "Start Again": "Start Again",
  "Start Scanning": "Start Scanning",
  "Stay here": "Stay here",
  "Terms for using Kayle ID and its identity verification features.":
    "Terms for using Kayle ID and its identity verification features.",
  "Terms of Service": "Terms of Service",
  "This %@ doesn't appear to support NFC":
    "This %@ doesn't appear to support NFC",
  "This will stop the current verification on this device.":
    "This will stop the current verification on this device.",
  "Try Again": "Try Again",
  "Try Another Document": "Try Another Document",
  "Uploading your %@ securely": "Uploading your %@ securely",
  "Use your camera to scan the printed code on your document, then read the chip if it has one.":
    "Use your camera to scan the printed code on your document, then read the chip if it has one.",
  "Use your camera to scan the QR code from your browser and begin verification.":
    "Use your camera to scan the QR code from your browser and begin verification.",
  "Verification Complete": "Verification Complete",
  "Verification Failed": "Verification Failed",
  "We couldn't use this scan to read the chip. Try scanning again.":
    "We couldn't use this scan to read the chip. Try scanning again.",
  "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible.":
    "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible.",
  "When you're ready, tap Start Scanning and follow the NFC prompt.":
    "When you're ready, tap Start Scanning and follow the NFC prompt.",
  "Yes, I see it": "Yes, I see it",
  "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.":
    "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.",
} as const;

export type IosCopyKey = keyof typeof IOS_COPY_EN;
export type IosCopy = Record<IosCopyKey, string>;
