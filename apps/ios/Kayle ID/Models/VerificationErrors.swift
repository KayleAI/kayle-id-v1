import Foundation

enum VerificationError: LocalizedError {
  case notInitialized
  case encryptionFailed
  case uploadFailed
  case verificationInterrupted
  case missingRequiredNFCData(String, documentChipName: String)

  var errorDescription: String? {
    switch self {
    case .notInitialized:
      return String(localized: "Session not initialized. Please scan a QR code.")
    case .encryptionFailed:
      return String(localized: "Failed to encrypt data.")
    case .uploadFailed:
      return String(localized: "Failed to upload data. Please try again.")
    case .verificationInterrupted:
      return String(
        localized:
          "Connection to the verification session was lost. Start again from the beginning."
      )
    case .missingRequiredNFCData(let dataGroup, let documentChipName):
      return String(
        localized:
          "Missing \(dataGroup) from NFC read. Please scan your \(documentChipName) again."
      )
    }
  }
}

enum LivenessError: LocalizedError, Equatable {
  case captureFailed
  case videoReadFailed
  case videoEmpty
  case uploadFailed

  var errorDescription: String? {
    switch self {
    case .captureFailed:
      return String(localized: "Liveness recording failed. Please try again.")
    case .videoReadFailed:
      return String(
        localized: "Could not read the recorded video. Please try again."
      )
    case .videoEmpty:
      return String(
        localized: "The recorded liveness video was empty. Please try again."
      )
    case .uploadFailed:
      return String(
        localized: "Failed to upload the liveness recording. Please try again."
      )
    }
  }
}
