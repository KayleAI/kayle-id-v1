enum VerificationStep: Int, CaseIterable {
  case welcome
  case scanning
  case mrz
  case rfidCheck
  case rfidUnsupported
  case nfc
  case livenessIntro
  case liveness
  case shareDetails
  case complete
  case error

  var title: String {
    switch self {
    case .welcome: return "Welcome"
    case .scanning: return "Scan QR Code"
    case .mrz: return "Scan Document"
    case .rfidCheck: return "RFID Check"
    case .rfidUnsupported: return "Unsupported Document"
    case .nfc: return "Read Chip"
    case .livenessIntro: return "Liveness Instructions"
    case .liveness: return "Liveness Check"
    case .shareDetails: return "Review Details"
    case .complete: return "Complete"
    case .error: return "Error"
    }
  }
}

enum AttemptPhase: String, Codable {
  case initialized = "initialized"
  case mobileConnected = "mobile_connected"
  case mrzScanning = "mrz_scanning"
  case mrzComplete = "mrz_complete"
  case nfcReading = "nfc_reading"
  case nfcComplete = "nfc_complete"
  case livenessCapturing = "liveness_capturing"
  case livenessComplete = "liveness_complete"
  case uploading = "uploading"
  case complete = "complete"
  case error = "error"
}

nonisolated func isVerificationStepReconnectable(_ step: VerificationStep) -> Bool {
  switch step {
  case .welcome, .scanning, .complete, .error:
    return false
  case .mrz,
       .rfidCheck,
       .rfidUnsupported,
       .nfc,
       .livenessIntro,
       .liveness,
       .shareDetails:
    return true
  }
}
