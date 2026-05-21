import Foundation

extension VerificationSession {
  nonisolated static func chunkData(_ raw: Data, chunkSize: Int) -> [Data] {
    if raw.count <= chunkSize {
      return [raw]
    }

    var chunks: [Data] = []
    var offset = 0

    while offset < raw.count {
      let end = min(offset + chunkSize, raw.count)
      chunks.append(raw.subdata(in: offset..<end))
      offset = end
    }

    return chunks
  }

  func uploadDataPlan(
    _ plan: DataUploadPlan,
    via webSocketService: VerifyWebSocketService,
    startingAt startChunkIndex: Int = 0,
    cancellationError: Error? = nil,
    unexpectedResponseMessage: String,
    shouldCancel: () -> Bool = { false },
    onChunkAcknowledged: ((String, Int, Int, VerifyDataKind) -> Void)? = nil
  ) async throws {
    guard !plan.chunks.isEmpty else {
      throw VerificationError.uploadFailed
    }

    let clampedStartChunkIndex = max(0, min(startChunkIndex, plan.chunks.count - 1))
    var nextChunkIndex = clampedStartChunkIndex
    var activeWindowSize = uploadWindowSize
    let chunkTotal = plan.chunks.count

    uploadLoop: while nextChunkIndex < chunkTotal {
      if shouldCancel() {
        throw cancellationError ?? VerificationError.uploadFailed
      }

      do {
        let windowEndIndex = min(nextChunkIndex + activeWindowSize, chunkTotal)
        let requests = (nextChunkIndex..<windowEndIndex).map(plan.request)
        let responses = try await webSocketService.sendDataWindowAwaitResponses(
          requests
        )

        var acknowledgedChunkIndices = Set<Int>()
        for response in responses {
          if let code = response.errorCode {
            let message = response.errorMessage ?? code
            guard
              let retryInstruction = parseChunkRetryInstruction(
                errorCode: code,
                errorMessage: message
              ),
              isRetryInstruction(retryInstruction, for: plan, chunkTotal: chunkTotal)
            else {
              throw VerifyWebSocketError.serverError(
                code: code,
                message: message
              )
            }

            nextChunkIndex = retryInstruction.chunkIndex
            activeWindowSize = 1
            continue uploadLoop
          }

          guard
            let matchingRequest = requests.first(where: { request in
              isExpectedDataAck(
                ackMessage: response.ackMessage,
                kind: plan.kind.rawValue,
                index: plan.index,
                chunkIndex: request.chunkIndex,
                chunkTotal: chunkTotal
              )
            })
          else {
            throw VerifyWebSocketError.unexpectedServerResponse(
              describeUnexpectedServerMessage(
                response,
                fallback: unexpectedResponseMessage
              )
            )
          }

          onChunkAcknowledged?(
            plan.acknowledgementKey(for: matchingRequest.chunkIndex),
            matchingRequest.chunkIndex,
            chunkTotal,
            plan.kind
          )
          acknowledgedChunkIndices.insert(matchingRequest.chunkIndex)
        }

        guard acknowledgedChunkIndices.count == requests.count else {
          throw VerifyWebSocketError.unexpectedServerResponse(
            unexpectedResponseMessage
          )
        }

        nextChunkIndex = windowEndIndex
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        guard
          let retryInstruction = parseChunkRetryInstruction(
            errorCode: code,
            errorMessage: message
          ),
          isRetryInstruction(retryInstruction, for: plan, chunkTotal: chunkTotal)
        else {
          throw socketError
        }

        nextChunkIndex = retryInstruction.chunkIndex
        activeWindowSize = 1
      }
    }
  }

  private func isRetryInstruction(
    _ retryInstruction: VerifyChunkRetryInstruction,
    for plan: DataUploadPlan,
    chunkTotal: Int
  ) -> Bool {
    retryInstruction.kind == plan.kind.rawValue &&
      retryInstruction.index == plan.index &&
      retryInstruction.chunkIndex >= 0 &&
      retryInstruction.chunkIndex < chunkTotal
  }
}
