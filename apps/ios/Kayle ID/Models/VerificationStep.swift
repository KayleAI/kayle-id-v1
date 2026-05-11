/// The current step in the verification flow.
enum VerificationStep: Int, CaseIterable {
  case welcome        // Landing screen
  case scanning       // Scanning QR code
  case mrz            // Scanning document MRZ
  case rfidCheck      // Asking if document has RFID (required, no skip)
  case rfidUnsupported // Document does not support RFID/NFC
  case nfc            // Reading NFC chip
  case selfieIntro    // Preparing the user for selfie capture
  case selfie         // Taking selfie
  case shareDetails   // Review requested fields
  case complete       // Verification complete
  case error          // Error state

  var title: String {
    switch self {
    case .welcome: return "Welcome"
    case .scanning: return "Scan QR Code"
    case .mrz: return "Scan Document"
    case .rfidCheck: return "RFID Check"
    case .rfidUnsupported: return "Unsupported Document"
    case .nfc: return "Read Chip"
    case .selfieIntro: return "Selfie Instructions"
    case .selfie: return "Take Selfie"
    case .shareDetails: return "Review Details"
    case .complete: return "Complete"
    case .error: return "Error"
    }
  }
}

/// Attempt phase values matching the API.
/// These correspond to `AttemptPhase` in `packages/config/src/e2ee-types.ts`.
enum AttemptPhase: String, Codable {
  case initialized = "initialized"
  case mobileConnected = "mobile_connected"
  case mrzScanning = "mrz_scanning"
  case mrzComplete = "mrz_complete"
  case nfcReading = "nfc_reading"
  case nfcComplete = "nfc_complete"
  case selfieCapturing = "selfie_capturing"
  case selfieComplete = "selfie_complete"
  case uploading = "uploading"
  case complete = "complete"
  case error = "error"
}

/// Whether a websocket disconnect on this step can be transparently recovered
/// by reconnecting (versus restarting the whole flow). Steps that haven't
/// claimed an attempt yet, or that have already reached a terminal outcome,
/// cannot benefit from a websocket retry.
nonisolated func isVerificationStepReconnectable(_ step: VerificationStep) -> Bool {
  switch step {
  case .welcome, .scanning, .complete, .error:
    return false
  case .mrz,
       .rfidCheck,
       .rfidUnsupported,
       .nfc,
       .selfieIntro,
       .selfie,
       .shareDetails:
    return true
  }
}
