import type { Locale } from "./i18n";

/**
 * Source-of-truth dictionary for iOS user-facing strings. The TS object here
 * drives `apps/ios/Kayle ID/Localizable.xcstrings` via the
 * `scripts/generate-ios-catalog.ts` generator — Xcode reads the generated
 * catalog at build time, the catalog is checked into git, and the TS dict is
 * what translators edit.
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
  About: "About",
  "Align the printed code within the box.":
    "Align the printed code within the box.",
  "An unexpected error occurred.": "An unexpected error occurred.",
  Back: "Back",
  Cancel: "Cancel",
  "Checking verification…": "Checking verification…",
  "Choose what to share": "Choose what to share",
  Continue: "Continue",
  "Do you see this symbol?": "Do you see this symbol?",
  Done: "Done",
  "Get Started": "Get Started",
  "How Kayle ID collects, uses, and protects your information.":
    "How Kayle ID collects, uses, and protects your information.",
  "I don't see it": "I don't see it",
  "If you have another supported %@, you can scan that instead.":
    "If you have another supported %@, you can scan that instead.",
  "Kayle ID": "Kayle ID",
  "Kayle ID needs %@ with the RFID symbol on %@ to continue on iPhone.":
    "Kayle ID needs %@ with the RFID symbol on %@ to continue on iPhone.",
  "Let's read your ID": "Let's read your ID",
  "Let’s verify your identity in a few quick steps.":
    "Let’s verify your identity in a few quick steps.",
  "Look for this symbol on %@.": "Look for this symbol on %@.",
  "Next, take a quick selfie": "Next, take a quick selfie",
  "Privacy Policy": "Privacy Policy",
  "Reconnecting…": "Reconnecting…",
  "Retry Verification": "Retry Verification",
  "Scan the QR code": "Scan the QR code",
  "Scan your document": "Scan your document",
  "Start Again": "Start Again",
  "Stay here": "Stay here",
  "Terms for using Kayle ID and its identity verification features.":
    "Terms for using Kayle ID and its identity verification features.",
  "Terms of Service": "Terms of Service",
  "This %@ doesn't appear to support NFC":
    "This %@ doesn't appear to support NFC",
  "This will stop the current verification on this device.":
    "This will stop the current verification on this device.",
  "Try Another Document": "Try Another Document",
  "Use your camera to scan the printed code on your document, then read the chip if it has one.":
    "Use your camera to scan the printed code on your document, then read the chip if it has one.",
  "Use your camera to scan the QR code from your browser and begin verification.":
    "Use your camera to scan the QR code from your browser and begin verification.",
  "Verification Complete": "Verification Complete",
  "Verification Failed": "Verification Failed",
  "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible.":
    "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible.",
  "Yes, I see it": "Yes, I see it",
  "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.":
    "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.",
} as const;

export type IosCopyKey = keyof typeof IOS_COPY_EN;
export type IosCopy = Record<IosCopyKey, string>;

/**
 * Per-locale iOS dictionaries. The English entry IS the source-of-truth; any
 * additional locale must provide a full set of translations for every key —
 * the `Record<Locale, IosCopy>` typing makes a missing translation a
 * compile error rather than a runtime fallback.
 */
export const IOS_COPY_BY_LOCALE: Record<Locale, IosCopy> = {
  en: IOS_COPY_EN,
};
