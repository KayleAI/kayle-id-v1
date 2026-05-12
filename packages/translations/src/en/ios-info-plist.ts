/**
 * English source-of-truth for Info.plist localizable keys.
 *
 * Driven by the same generator that produces Localizable.xcstrings; it
 * emits a sibling `InfoPlist.xcstrings` catalog that iOS reads automatically
 * when surfacing system-level dialogs (camera and NFC permission prompts).
 *
 * Keys are Info.plist key names verbatim — not arbitrary strings. Adding a
 * key here only takes effect if the matching key actually exists in
 * `apps/ios/Kayle ID/Info.plist`.
 */
export const IOS_INFO_PLIST_EN = {
  NFCReaderUsageDescription: "Used to read identity-document NFC data.",
  NSCameraUsageDescription: "Used to scan the MRZ on your identity document.",
} as const;

export type IosInfoPlistKey = keyof typeof IOS_INFO_PLIST_EN;
export type IosInfoPlist = Record<IosInfoPlistKey, string>;
