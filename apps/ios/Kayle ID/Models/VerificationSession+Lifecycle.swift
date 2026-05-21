import Foundation

extension VerificationSession {
  func handleError(_ error: Error, forSessionId sessionId: String? = nil) {
    handleError(error, forSessionId: sessionId, attemptReconnect: true)
  }

  func handleRetryError(_ error: Error, forSessionId sessionId: String? = nil) {
    if let sessionId {
      guard
        shouldHandleSessionScopedEvent(
          currentSessionId: payload?.sessionId,
          eventSessionId: sessionId
        )
      else {
        return
      }
    }

    let resolvedError = resolveDisplayError(error)
    errorMessage = String(
      localized: "Retry could not start. \(resolvedError.localizedDescription)"
    )
    isRetryingVerification = false
    step = .complete
  }

  func bootstrapSession(
    with payload: QRCodePayload,
    initializationToken: UUID? = nil
  ) async throws {
    let service = makeWebSocketService(for: payload)
    initializingWebSocketService = service
    defer {
      if initializingWebSocketService === service {
        initializingWebSocketService = nil
      }
    }

    do {
      try service.connect()
      try ensureBootstrapStillCurrent(
        initializationToken: initializationToken,
        service: service
      )
      try await service.sendHello()
      try ensureBootstrapStillCurrent(
        initializationToken: initializationToken,
        service: service
      )
    } catch {
      service.disconnect()
      throw error
    }

    try ensureBootstrapStillCurrent(
      initializationToken: initializationToken,
      service: service
    )
    let activeWebSocketService = webSocketService
    resetSessionState(clearPayload: false)
    activeWebSocketService?.disconnect()
    self.payload = payload
    webSocketService = service
    await updatePhase(.mobileConnected)
  }

  func teardownSessionState(clearPayload: Bool) {
    let activeWebSocketService = webSocketService
    let activeInitializingService = initializingWebSocketService
    resetSessionState(clearPayload: clearPayload)
    activeWebSocketService?.disconnect()
    activeInitializingService?.disconnect()
  }

  func closeActiveSessionConnection() {
    let activeWebSocketService = webSocketService
    webSocketService = nil
    pendingPhaseUpdateTask?.cancel()
    pendingPhaseUpdateTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
    isReconnecting = false
    resetNFCUploadState()
    activeWebSocketService?.disconnect()
  }

  func handleCheckResult(_ checkResult: VerifyServerCheckResult) {
    self.checkResult = checkResult
    self.remainingNfcRetries = checkResult.remainingNfcRetries
    self.remainingLivenessRetries = checkResult.remainingLivenessRetries
    self.failedCheck = checkResult.failedCheck
    errorMessage = nil
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    livenessUploadCancelled = isNotConfirmedCheck(checkResult)

    if isNotConfirmedCheck(checkResult) {
      if !checkResult.retryAllowed {
        closeActiveSessionConnection()
      }
      shareRequest = nil
      selectedShareFieldKeys = []
      moveToStep(.complete)
    }
  }

  func queuePhaseUpdate(_ phase: AttemptPhase, error: String?) {
    let previousTask = pendingPhaseUpdateTask
    pendingPhaseUpdateTask = Task { @MainActor [weak self] in
      await previousTask?.value

      guard let self, let webSocketService = self.webSocketService else {
        return
      }

      do {
        try await webSocketService.sendPhase(phase, error: error)
      } catch {
#if DEBUG
        print("Failed to update phase \(phase.rawValue): \(error.localizedDescription)")
#endif
      }
    }
  }

  func handleError(
    _ error: Error,
    forSessionId sessionId: String?,
    attemptReconnect: Bool
  ) {
    if let sessionId {
      guard
        shouldHandleSessionScopedEvent(
          currentSessionId: payload?.sessionId,
          eventSessionId: sessionId
        )
      else {
        return
      }
    }

    guard step != .error else {
      return
    }

    let socketError = error as? VerifyWebSocketError
    let isTransientConnectionLoss =
      socketError.map { isVerificationSessionConnectionLoss($0) } ?? false
    let isAuthFailure = socketError?.isNonRetryableAuthFailure ?? false

    if isTransientConnectionLoss, step == .nfc, isUploadingNFC {
      resetNFCUploadState()
      return
    }

    if
      attemptReconnect,
      isTransientConnectionLoss,
      !isAuthFailure,
      let activePayload = payload,
      isVerificationStepReconnectable(step)
    {
      if !isReconnecting {
        scheduleReconnect(forSessionId: sessionId ?? activePayload.sessionId)
      }
      return
    }

    let resolvedError = resolveDisplayError(error)
    let terminalSessionId = sessionId ?? payload?.sessionId
    reconnectTask?.cancel()
    reconnectTask = nil
    isReconnecting = false
    checkResult = nil
    errorMessage = resolvedError.localizedDescription
    isRetryingVerification = false
    step = .error
    livenessUploadCancelled = true

    Task { @MainActor [weak self] in
      guard let self else { return }
      await updatePhase(.error, error: resolvedError.localizedDescription)
      await waitForPendingPhaseUpdates()
      guard let terminalSessionId else { return }

      guard
        shouldHandleSessionScopedEvent(
          currentSessionId: self.payload?.sessionId,
          eventSessionId: terminalSessionId
        )
      else {
        return
      }

      self.closeActiveSessionConnection()
    }
  }

  private func ensureBootstrapStillCurrent(
    initializationToken: UUID?,
    service: VerifyWebSocketService
  ) throws {
    guard let initializationToken else {
      try Task.checkCancellation()
      return
    }

    guard initializationCancellationToken == initializationToken else {
      service.disconnect()
      throw CancellationError()
    }

    try Task.checkCancellation()
  }

  private func resetSessionState(clearPayload: Bool) {
    if clearPayload {
      payload = nil
    }

    checkResult = nil
    errorMessage = nil
    isRetryingVerification = false
    isReconnecting = false
    shareRequest = nil
    selectedShareFieldKeys = []
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    mrzResult = nil
    nfcResult = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessChallenge = nil
    hasRFIDSymbol = nil
    webSocketService = nil
    initializingWebSocketService = nil
    livenessUploadStarted = false
    livenessUploadComplete = false
    livenessUploadCancelled = false
    cancelLivenessUploadWaiters()
    resetNFCUploadState()
    pendingPhaseUpdateTask?.cancel()
    pendingPhaseUpdateTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
  }

  private func resolveDisplayError(_ error: Error) -> Error {
    guard let socketError = error as? VerifyWebSocketError else {
      return error
    }

    if isVerificationSessionConnectionLoss(socketError) {
      return VerificationError.verificationInterrupted
    }

    return socketError
  }
}
