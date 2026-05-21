import Foundation
import OSLog

extension VerificationSession {
  func sendLivenessVideo(_ videoURL: URL) async throws -> Bool {
    let uploadStartedAt = Date()
    defer {
      let durationMs = Int(Date().timeIntervalSince(uploadStartedAt) * 1000)
      performanceLogger.info("liveness_upload_duration_ms=\(durationMs)")
    }

    try await waitForLivenessUploadTurn()
    defer {
      releaseLivenessUploadSlot()
    }

    guard let webSocketService else {
      throw VerificationError.notInitialized
    }

    await waitForPendingPhaseUpdates()

    if livenessUploadCancelled {
      throw LivenessError.uploadFailed
    }

    let plan = try await Self.buildLivenessUploadPlan(
      videoURL: videoURL,
      chunkSize: livenessChunkSize
    )

    livenessVideoBytes = plan.videoBytes
    livenessUploadStarted = true

    try await uploadLivenessPlan(plan, via: webSocketService)
    try await completeLivenessPhase(plan: plan, via: webSocketService)
    livenessUploadComplete = true
    return true
  }

  nonisolated static func buildLivenessUploadPlan(
    videoURL: URL,
    chunkSize: Int
  ) async throws -> LivenessUploadPlan {
    try await Task.detached(priority: .userInitiated) {
      let videoBytes: Data
      do {
        videoBytes = try Data(contentsOf: videoURL, options: .mappedIfSafe)
      } catch {
        throw LivenessError.videoReadFailed
      }

      guard !videoBytes.isEmpty else {
        throw LivenessError.videoEmpty
      }

      return LivenessUploadPlan(
        videoBytes: videoBytes,
        upload: DataUploadPlan(
          kind: .livenessVideo,
          chunks: Self.chunkData(videoBytes, chunkSize: chunkSize)
        )
      )
    }.value
  }

  func uploadLivenessPlan(
    _ plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService,
    startingAt startChunkIndex: Int = 0
  ) async throws {
    try await uploadDataPlan(
      plan.upload,
      via: webSocketService,
      startingAt: startChunkIndex,
      cancellationError: LivenessError.uploadFailed,
      unexpectedResponseMessage: String(
        localized: "Unexpected liveness upload response from the server."
      ),
      shouldCancel: { [weak self] in
        self?.livenessUploadCancelled ?? true
      }
    )
  }

  func completeLivenessPhase(
    plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    while true {
      do {
        let response = try await webSocketService.sendPhaseAwaitResponse(
          .livenessComplete,
          error: nil
        )

        if let checkResult = response.checkResult {
          handleCheckResult(checkResult)
          return
        }

        throw VerifyWebSocketError.unexpectedServerResponse(
          describeUnexpectedServerMessage(
            response,
            fallback: String(
              localized:
                "Unexpected liveness completion response from the server."
            )
          )
        )
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        if
          parseMissingNFCDataInstruction(
            errorCode: code,
            errorMessage: message
          ) != nil,
          let nfcResult
        {
          try await restreamNFCArtifacts(
            nfcResult: nfcResult,
            via: webSocketService
          )
          continue
        }

        guard
          let missingInstruction = parseMissingLivenessDataInstruction(
            errorCode: code,
            errorMessage: message
          )
        else {
          throw socketError
        }

        try await resendMissingLivenessData(
          missingInstruction,
          plan: plan,
          via: webSocketService
        )
      }
    }
  }

  func resendMissingLivenessData(
    _ missingInstruction: VerifyMissingLivenessDataInstruction,
    plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    if missingInstruction.missingChunks.isEmpty {
      try await uploadLivenessPlan(plan, via: webSocketService)
      return
    }

    for missingChunk in missingInstruction.missingChunks {
      guard missingChunk.kind == VerifyDataKind.livenessVideo.rawValue else {
        continue
      }

      for chunkIndex in missingChunk.missingChunkIndices.sorted() {
        guard chunkIndex >= 0, chunkIndex < plan.upload.chunks.count else {
          continue
        }
        try await uploadLivenessPlan(
          plan,
          via: webSocketService,
          startingAt: chunkIndex
        )
      }
    }
  }
}
