import Foundation

extension VerifyWebSocketService {
  func waitForServerResponse(
    allowServerErrorMessage: Bool = false
  ) async throws -> VerifyServerMessage {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<VerifyServerMessage, Error>) in
      var immediateResult: Result<VerifyServerMessage, VerifyWebSocketError>?
      stateQueue.sync {
        if !queuedServerResponses.isEmpty {
          let message = queuedServerResponses.removeFirst()
          immediateResult = serverResponseResult(
            for: message,
            allowServerErrorMessage: allowServerErrorMessage
          )
          return
        }

        pendingServerResponseContinuation = continuation
        pendingServerResponseAllowsErrorMessage = allowServerErrorMessage
        serverResponseTimeoutTask?.cancel()
        serverResponseTimeoutTask = Task { [weak self] in
          guard let self else { return }
          do {
            try await Task.sleep(nanoseconds: self.serverResponseTimeoutNs)
          } catch {
            return
          }
          self.resolvePendingServerResponse(.failure(.serverResponseTimedOut))
        }
      }

      if let immediateResult {
        switch immediateResult {
        case .success(let message):
          continuation.resume(returning: message)
        case .failure(let error):
          continuation.resume(throwing: error)
        }
      }
    }
  }

  func resolvePendingServerResponse(
    _ result: Result<VerifyServerMessage, VerifyWebSocketError>
  ) {
    let continuation: CheckedContinuation<VerifyServerMessage, Error>? = stateQueue.sync {
      let pending = pendingServerResponseContinuation
      pendingServerResponseContinuation = nil
      pendingServerResponseAllowsErrorMessage = false
      serverResponseTimeoutTask?.cancel()
      serverResponseTimeoutTask = nil
      if case .failure = result {
        queuedServerResponses.removeAll()
      }
      return pending
    }

    guard let continuation else {
      return
    }

    switch result {
    case .success(let message):
      continuation.resume(returning: message)
    case .failure(let error):
      continuation.resume(throwing: error)
    }
  }

  func consumeExpectedCheckResultClose() -> Bool {
    stateQueue.sync {
      let expected = expectedCheckResultClose
      expectedCheckResultClose = false
      return expected
    }
  }

  func handleFatalError(_ error: VerifyWebSocketError) {
    Task { @MainActor [onFatalError] in
      onFatalError?(error)
    }
  }

  func receiveLoop(for task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      guard self.isCurrentTask(task) else { return }
      switch result {
      case .success(let message):
        self.handleReceivedMessage(message)
      case .failure(let error):
        #if DEBUG
        print("WebSocket receive error: \(error)")
        #endif
        if self.consumeExpectedCheckResultClose() {
          return
        }
        self.handleUnexpectedConnectionLoss()
        return
      }
      self.receiveLoop(for: task)
    }
  }

  private func handleReceivedMessage(
    _ message: URLSessionWebSocketTask.Message
  ) {
    switch message {
    case .data(let data):
      guard let serverMessage = codec.decodeServerMessage(data) else {
        return
      }
      handleServerMessage(serverMessage)
    case .string(let text):
      #if DEBUG
      print("Unexpected WebSocket text: \(text)")
      #endif
    @unknown default:
      break
    }
  }

  private func handleServerMessage(
    _ serverMessage: VerifyServerMessage
  ) {
    if handleOutOfBandServerMessage(serverMessage) {
      return
    }

    if isAwaitingHelloResponse(),
      handleHelloResponse(serverMessage)
    {
      return
    }

    if isAwaitingServerResponse(),
      handleAwaitedServerMessage(serverMessage)
    {
      return
    }

    if handleQueuedServerMessage(serverMessage) {
      return
    }

    logUnhandledServerMessage(serverMessage)
  }

  private func handleOutOfBandServerMessage(
    _ serverMessage: VerifyServerMessage
  ) -> Bool {
    if let challenge = serverMessage.activeAuthChallenge {
      #if DEBUG
      print("WS <- activeAuthChallenge bytes=\(challenge.count)")
      #endif
      handleActiveAuthChallenge(challenge)
      return true
    }

    if let livenessChallenge = serverMessage.livenessChallenge {
      #if DEBUG
      print(
        "WS <- livenessChallenge duration=\(livenessChallenge.maxDurationMs)ms nonce=\(livenessChallenge.challengeNonce.count)B"
      )
      #endif
      handleLivenessChallenge(livenessChallenge)
      return true
    }

    return false
  }

  private func handleHelloResponse(
    _ serverMessage: VerifyServerMessage
  ) -> Bool {
    guard
      let helloResponse = parseHelloResponse(
        ackMessage: serverMessage.ackMessage,
        errorCode: serverMessage.errorCode,
        errorMessage: serverMessage.errorMessage
      )
    else {
      return false
    }

    switch helloResponse {
    case .success:
      startKeepalive()
      resolvePendingHello(.success(()))
    case .failure(let code, let message):
      let error = VerifyWebSocketError.serverError(
        code: code,
        message: message
      )
      resolvePendingHello(.failure(error))
      if error.isNonRetryableAuthFailure {
        handleFatalError(error)
      }
    }
    return true
  }

  private func handleAwaitedServerMessage(
    _ serverMessage: VerifyServerMessage
  ) -> Bool {
    if let shareRequest = serverMessage.shareRequest {
      handleShareRequest(shareRequest)
      return true
    }

    if serverMessage.errorCode != nil {
      handleServerResponse(serverMessage)
      return true
    }

    if let checkResult = serverMessage.checkResult {
      if shouldSuppressReconnectAfterHandledCheckResult(checkResult) {
        expectCheckResultClose()
      }
      handleServerResponse(serverMessage)
      return true
    }

    if serverMessage.shareReady != nil || serverMessage.ackMessage != nil {
      handleServerResponse(serverMessage)
      return true
    }

    return false
  }

  private func handleQueuedServerMessage(
    _ serverMessage: VerifyServerMessage
  ) -> Bool {
    if let shareRequest = serverMessage.shareRequest {
      handleShareRequest(shareRequest)
      return true
    }

    if
      serverMessage.errorCode != nil ||
      serverMessage.checkResult != nil ||
      serverMessage.shareReady != nil ||
      serverMessage.ackMessage != nil
    {
      handleServerResponse(serverMessage)
      return true
    }

    return false
  }

  private func serverResponseResult(
    for message: VerifyServerMessage,
    allowServerErrorMessage: Bool
  ) -> Result<VerifyServerMessage, VerifyWebSocketError> {
    if let code = message.errorCode, !allowServerErrorMessage {
      return .failure(
        VerifyWebSocketError.serverError(
          code: code,
          message: message.errorMessage ?? code
        )
      )
    }

    return .success(message)
  }

  private func handleServerResponse(_ message: VerifyServerMessage) {
    let resolution: (
      continuation: CheckedContinuation<VerifyServerMessage, Error>,
      result: Result<VerifyServerMessage, VerifyWebSocketError>
    )? = stateQueue.sync {
      guard let continuation = pendingServerResponseContinuation else {
        queuedServerResponses.append(message)
        return nil
      }

      let result = serverResponseResult(
        for: message,
        allowServerErrorMessage: pendingServerResponseAllowsErrorMessage
      )
      pendingServerResponseContinuation = nil
      pendingServerResponseAllowsErrorMessage = false
      serverResponseTimeoutTask?.cancel()
      serverResponseTimeoutTask = nil
      return (continuation, result)
    }

    guard let resolution else {
      return
    }

    switch resolution.result {
    case .success(let message):
      resolution.continuation.resume(returning: message)
    case .failure(let error):
      resolution.continuation.resume(throwing: error)
    }
  }

  private func isAwaitingHelloResponse() -> Bool {
    stateQueue.sync {
      pendingHelloContinuation != nil
    }
  }

  private func isAwaitingServerResponse() -> Bool {
    stateQueue.sync {
      pendingServerResponseContinuation != nil
    }
  }

  private func expectCheckResultClose() {
    stateQueue.sync {
      expectedCheckResultClose = true
    }
  }

  private func handleShareRequest(_ shareRequest: VerifyShareRequest) {
    Task { @MainActor [onShareRequest] in
      onShareRequest?(shareRequest)
    }
  }

  private func handleActiveAuthChallenge(_ challenge: Data) {
    Task { @MainActor [onActiveAuthChallenge] in
      onActiveAuthChallenge?(challenge)
    }
  }

  private func handleLivenessChallenge(
    _ challenge: VerifyServerLivenessChallenge
  ) {
    Task { @MainActor [onLivenessChallenge] in
      onLivenessChallenge?(challenge)
    }
  }

  private func logUnhandledServerMessage(_ serverMessage: VerifyServerMessage) {
    #if DEBUG
    if let ack = serverMessage.ackMessage {
      print("WS <- ack \(ack)")
    } else if let checkResult = serverMessage.checkResult {
      let checkResultLabel: String
      switch checkResult.outcome {
      case .confirmed:
        checkResultLabel = "confirmed"
      case .notConfirmed:
        checkResultLabel = "not_confirmed"
      }
      print(
        "WS <- checkResult \(checkResultLabel) \(checkResult.reasonCode)"
      )
    } else if let shareRequest = serverMessage.shareRequest {
      print(
        "WS <- shareRequest fields=\(shareRequest.fields.count)"
      )
    } else if let shareReady = serverMessage.shareReady {
      print(
        "WS <- shareReady fields=\(shareReady.selectedFieldKeys.count)"
      )
    } else if let errorMessage = serverMessage.errorMessage {
      let code = serverMessage.errorCode ?? "unknown"
      print("WS <- error \(code) \(errorMessage)")
    } else {
      print("WS <- message")
    }
    #endif

    if let error = serverMessage.errorMessage {
      let code = serverMessage.errorCode ?? "unknown"
      #if DEBUG
      print("WebSocket error: \(code) \(error)")
      #endif
    }
  }
}
