import Foundation

extension VerifyWebSocketService {
  func sendPhase(
    _ phase: AttemptPhase,
    error: String?,
    attestAssertion: Data = Data()
  ) async throws {
    let response = try await sendPhaseAwaitResponse(
      phase,
      error: error,
      attestAssertion: attestAssertion
    )
    guard isExpectedPhaseAck(response.ackMessage) else {
      throw VerifyWebSocketError.unexpectedServerResponse(
        describeUnexpectedServerMessage(
          response,
          fallback: String(
            localized:
              "Unexpected verification phase response from the server."
          )
        )
      )
    }
  }

  func sendPhaseAwaitResponse(
    _ phase: AttemptPhase,
    error: String?,
    attestAssertion: Data = Data()
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodePhase(
      phase: phase.rawValue,
      error: error,
      attestAssertion: attestAssertion
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    return try await sendPayloadAwaitingServerResponse(payload)
  }

  func sendData(
    kind: VerifyDataKind,
    raw: Data,
    index: Int? = nil,
    total: Int? = nil,
    chunkIndex: Int? = nil,
    chunkTotal: Int? = nil
  ) async throws {
    guard let payload = codec.encodeData(
      kind: kind,
      raw: raw,
      index: index,
      total: total,
      chunkIndex: chunkIndex,
      chunkTotal: chunkTotal
    ) else {
      throw VerifyWebSocketError.sendFailed
    }
    #if DEBUG
    let size = raw.count
    let details = "kind=\(kind) size=\(size) index=\(index ?? 0) total=\(total ?? 0) chunk=\(chunkIndex ?? 0)/\(chunkTotal ?? 0)"
    print("WS -> data \(details)")
    #endif
    try await send(data: payload)
  }

  func sendDataAwaitResponse(
    kind: VerifyDataKind,
    raw: Data,
    index: Int? = nil,
    total: Int? = nil,
    chunkIndex: Int? = nil,
    chunkTotal: Int? = nil
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodeData(
      kind: kind,
      raw: raw,
      index: index,
      total: total,
      chunkIndex: chunkIndex,
      chunkTotal: chunkTotal
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    return try await sendPayloadAwaitingServerResponse(payload)
  }

  func sendDataWindowAwaitResponses(
    _ requests: [VerifyDataUploadRequest]
  ) async throws -> [VerifyServerMessage] {
    guard !requests.isEmpty else {
      return []
    }

    var payloads: [Data] = []
    payloads.reserveCapacity(requests.count)

    for request in requests {
      guard let payload = codec.encodeData(
        kind: request.kind,
        raw: request.raw,
        index: request.index,
        total: request.total,
        chunkIndex: request.chunkIndex,
        chunkTotal: request.chunkTotal
      ) else {
        throw VerifyWebSocketError.sendFailed
      }
      payloads.append(payload)
    }

    for (request, payload) in zip(requests, payloads) {
      #if DEBUG
      let details = "kind=\(request.kind) size=\(request.raw.count) index=\(request.index) total=\(request.total) chunk=\(request.chunkIndex)/\(request.chunkTotal)"
      print("WS -> data \(details)")
      #endif
      try await send(data: payload)
    }

    var responses: [VerifyServerMessage] = []
    responses.reserveCapacity(requests.count)
    for _ in requests {
      responses.append(
        try await waitForServerResponse(allowServerErrorMessage: true)
      )
    }
    return responses
  }

  func sendShareSelectionAwaitResponse(
    sessionId: String,
    selectedFieldKeys: [String]
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodeShareSelection(
      sessionId: sessionId,
      selectedFieldKeys: selectedFieldKeys
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    return try await sendPayloadAwaitingServerResponse(payload)
  }

  private func sendPayloadAwaitingServerResponse(
    _ payload: Data
  ) async throws -> VerifyServerMessage {
    let responseTask = Task { try await waitForServerResponse() }
    do {
      try await send(data: payload)
      return try await responseTask.value
    } catch {
      responseTask.cancel()
      if let wsError = error as? VerifyWebSocketError {
        throw wsError
      }
      throw VerifyWebSocketError.sendFailedWithReason(error.localizedDescription)
    }
  }

  func send(data: Data) async throws {
    guard let task = webSocketTask else {
      throw VerifyWebSocketError.notConnected
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let oneShotContinuation = OneShotContinuation(continuation)
      let timeoutTask = Task { [weak self, oneShotContinuation] in
        guard let self else {
          oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
          return
        }

        do {
          try await Task.sleep(nanoseconds: self.sendTimeoutNs)
        } catch {
          return
        }

        #if DEBUG
        print("WebSocket send timed out")
        #endif
        self.closeAfterSendFailure()
        oneShotContinuation.resume(
          throwing: VerifyWebSocketError.sendFailedWithReason(
            "Timed out sending WebSocket message."
          )
        )
      }

      task.send(.data(data)) { error in
        timeoutTask.cancel()
        if let error {
          if self.isConnectionLossError(error) {
            #if DEBUG
            print("WebSocket send failed after connection loss: \(error.localizedDescription)")
            #endif
            self.closeAfterSendFailure()
            oneShotContinuation.resume(
              throwing: VerifyWebSocketError.connectionClosed
            )
            return
          }

          #if DEBUG
          print("WebSocket send error: \(error.localizedDescription)")
          #endif
          oneShotContinuation.resume(
            throwing: VerifyWebSocketError.sendFailedWithReason(
              error.localizedDescription
            )
          )
        } else {
          oneShotContinuation.resume(returning: ())
        }
      }
    }
  }

  func sendPing() async throws {
    guard let task = webSocketTask else {
      throw VerifyWebSocketError.notConnected
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let oneShotContinuation = OneShotContinuation(continuation)
      let timeoutTask = Task { [weak self, oneShotContinuation] in
        guard let self else {
          oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
          return
        }

        do {
          try await Task.sleep(nanoseconds: self.sendTimeoutNs)
        } catch {
          return
        }

        #if DEBUG
        print("WebSocket ping timed out")
        #endif
        self.handleUnexpectedConnectionLoss()
        oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
      }

      task.sendPing { error in
        timeoutTask.cancel()
        if let error {
          oneShotContinuation.resume(
            throwing: VerifyWebSocketError.sendFailedWithReason(
              error.localizedDescription
            )
          )
        } else {
          oneShotContinuation.resume(returning: ())
        }
      }
    }
  }
}
