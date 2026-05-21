import Foundation

extension VerificationSession {
  func reset() {
    step = .welcome
    teardownSessionState(clearPayload: true)
  }

  func retryMRZ() async throws {
    guard payload != nil, webSocketService != nil else {
      throw VerificationError.notInitialized
    }
    errorMessage = nil
    checkResult = nil
    mrzResult = nil
    nfcResult = nil
    hasRFIDSymbol = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessChallenge = nil
    resetNFCUploadState()
    await updatePhase(.mrzScanning)
    moveToStep(.mrz)
  }

  func retryNFC() async throws {
    guard remainingNfcRetries > 0 else {
      throw VerificationError.notInitialized
    }
    guard payload != nil, webSocketService != nil else {
      throw VerificationError.notInitialized
    }
    errorMessage = nil
    checkResult = nil
    nfcResult = nil
    hasRFIDSymbol = nil
    resetNFCUploadState()
    await updatePhase(.nfcReading)
    moveToStep(.rfidCheck)
  }

  func retryLiveness() async throws {
    guard remainingLivenessRetries > 0 else {
      throw VerificationError.notInitialized
    }
    guard payload != nil, webSocketService != nil else {
      throw VerificationError.notInitialized
    }
    errorMessage = nil
    checkResult = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessUploadStarted = false
    livenessUploadComplete = false
    livenessUploadCancelled = false
    cancelLivenessUploadWaiters()
    livenessCaptureGeneration = UUID()
    await updatePhase(.livenessCapturing)
    moveToStep(.livenessIntro)
  }

  func cancelVerification() async throws {
    guard let currentPayload = payload else {
      throw VerificationError.notInitialized
    }

    guard let cancelToken = currentPayload.cancelToken else {
      return
    }

    try await APIService.cancelVerification(
      sessionId: currentPayload.sessionId,
      cancelToken: cancelToken
    )
  }

  func clearDocumentCaptureState() {
    mrzResult = nil
    nfcResult = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessChallenge = nil
    hasRFIDSymbol = nil
    resetNFCUploadState()
  }
}
