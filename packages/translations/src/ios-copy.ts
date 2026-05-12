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

const IOS_COPY_FR: IosCopy = {
  About: "À propos",
  "Align the printed code within the box.":
    "Alignez le code imprimé dans le cadre.",
  "An unexpected error occurred.": "Une erreur inattendue est survenue.",
  Back: "Retour",
  Cancel: "Annuler",
  "Checking verification…": "Vérification en cours…",
  "Choose what to share": "Choisissez ce que vous souhaitez partager",
  Continue: "Continuer",
  "Do you see this symbol?": "Voyez-vous ce symbole ?",
  Done: "Terminé",
  "Get Started": "Commencer",
  "How Kayle ID collects, uses, and protects your information.":
    "Comment Kayle ID collecte, utilise et protège vos informations.",
  "I don't see it": "Je ne le vois pas",
  "If you have another supported %@, you can scan that instead.":
    "Si vous avez un autre %@ pris en charge, vous pouvez le scanner à la place.",
  "Kayle ID": "Kayle ID",
  "Kayle ID needs %@ with the RFID symbol on %@ to continue on iPhone.":
    "Kayle ID a besoin d’%@ avec le symbole RFID sur %@ pour continuer sur iPhone.",
  "Let's read your ID": "Lisons votre pièce d’identité",
  "Let’s verify your identity in a few quick steps.":
    "Vérifions votre identité en quelques étapes rapides.",
  "Look for this symbol on %@.": "Cherchez ce symbole sur %@.",
  "Next, take a quick selfie": "Ensuite, prenez un selfie rapide",
  "Privacy Policy": "Politique de confidentialité",
  "Reconnecting…": "Reconnexion…",
  "Retry Verification": "Réessayer la vérification",
  "Scan the QR code": "Scannez le code QR",
  "Scan your document": "Scannez votre document",
  "Start Again": "Recommencer",
  "Stay here": "Rester ici",
  "Terms for using Kayle ID and its identity verification features.":
    "Conditions d’utilisation de Kayle ID et de ses fonctionnalités de vérification d’identité.",
  "Terms of Service": "Conditions de service",
  "This %@ doesn't appear to support NFC":
    "Ce %@ ne semble pas prendre en charge la NFC",
  "This will stop the current verification on this device.":
    "Cela arrêtera la vérification en cours sur cet appareil.",
  "Try Another Document": "Essayer un autre document",
  "Use your camera to scan the printed code on your document, then read the chip if it has one.":
    "Utilisez votre appareil photo pour scanner le code imprimé sur votre document, puis lisez la puce s’il en a une.",
  "Use your camera to scan the QR code from your browser and begin verification.":
    "Utilisez votre appareil photo pour scanner le code QR depuis votre navigateur et commencer la vérification.",
  "Verification Complete": "Vérification terminée",
  "Verification Failed": "Échec de la vérification",
  "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible.":
    "Nous capturerons automatiquement trois photos. Assurez-vous que votre visage est bien éclairé et clairement visible.",
  "Yes, I see it": "Oui, je le vois",
  "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.":
    "Vos données de vérification d’identité ont été transmises en toute sécurité. Vous pouvez maintenant fermer cette application et retourner à votre navigateur.",
};

/**
 * Per-locale iOS dictionaries. The English entry IS the source-of-truth; any
 * additional locale must provide a full set of translations for every key —
 * the `Record<Locale, IosCopy>` typing makes a missing translation a
 * compile error rather than a runtime fallback.
 */
export const IOS_COPY_BY_LOCALE: Record<Locale, IosCopy> = {
  en: IOS_COPY_EN,
  fr: IOS_COPY_FR,
};
