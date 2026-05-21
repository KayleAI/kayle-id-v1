import Foundation

extension VerificationSession {
  func scheduleReconnect(forSessionId sessionId: String) {
    reconnectTask?.cancel()
    isReconnecting = true

    let maxAttempts = maxReconnectAttempts
    let baseDelay = reconnectBaseDelayNs

    reconnectTask = Task { @MainActor [weak self] in
      guard let self else { return }
      var lastError: Error?
      var lastErrorCode: String?

      for attempt in 1...maxAttempts {
        if Task.isCancelled { return }

        guard
          let activePayload = self.payload,
          activePayload.sessionId == sessionId
        else {
          self.isReconnecting = false
          return
        }

        guard isVerificationStepReconnectable(self.step) else {
          self.isReconnecting = false
          return
        }

        if attempt > 1 {
          let exponent = min(attempt - 1, 4)
          let delayNs = baseDelay * UInt64(1 << exponent)
          do {
            try await Task.sleep(nanoseconds: delayNs)
          } catch {
            return
          }
          if Task.isCancelled { return }
        }

        do {
          try await self.performReconnect(with: activePayload)
          self.isReconnecting = false
          self.errorMessage = nil
          return
        } catch {
          lastError = error
          if let socketError = error as? VerifyWebSocketError {
            lastErrorCode = socketError.serverErrorCode
            if socketError.isNonRetryableAuthFailure {
              break
            }
          }

          if !shouldRetryReconnect(
            isAuthenticated: true,
            lastErrorCode: lastErrorCode,
            attempt: attempt,
            maxAttempts: maxAttempts
          ) {
            break
          }
        }
      }

      self.isReconnecting = false
      self.reconnectTask = nil
      self.handleError(
        lastError ?? VerifyWebSocketError.reconnectFailed,
        forSessionId: sessionId,
        attemptReconnect: false
      )
    }
  }

  private func performReconnect(with payload: QRCodePayload) async throws {
    let service = makeWebSocketService(for: payload)

    do {
      try service.connect()
      try await service.sendHello()
    } catch {
      service.disconnect()
      throw error
    }

    let previousService = webSocketService
    webSocketService = service
    previousService?.disconnect()

    resetNFCUploadState()
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessUploadStarted = false
    livenessUploadComplete = false
    livenessUploadCancelled = false
    cancelLivenessUploadWaiters()
    livenessCaptureGeneration = UUID()

    if let nfcResult {
      try await restreamNFCArtifacts(
        nfcResult: nfcResult,
        via: service
      )
    }
  }
}
