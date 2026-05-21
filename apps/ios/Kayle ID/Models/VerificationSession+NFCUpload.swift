import Foundation
import OSLog

extension VerificationSession {
  func uploadNFCData() async throws -> Bool {
    let uploadStartedAt = Date()
    defer {
      let durationMs = Int(Date().timeIntervalSince(uploadStartedAt) * 1000)
      performanceLogger.info("nfc_upload_duration_ms=\(durationMs)")
    }

    guard let nfcResult else {
      throw VerificationError.notInitialized
    }
    guard let webSocketService else {
      throw VerificationError.notInitialized
    }

    let plans = try buildNFCUploadPlans(from: nfcResult)
    let totalChunkCount = max(1, plans.reduce(0) { $0 + $1.chunks.count })
    var acknowledgedChunks = Set<String>()

    beginNFCUpload(totalChunkCount: totalChunkCount)
    defer {
      resetNFCUploadState()
    }

    await Task.yield()
    await waitForPendingPhaseUpdates()
    nfcUploadStatusMessage = String(localized: "Reconnecting to continue secure upload…")
    try await webSocketService.reconnectForTransfer()
    nfcUploadStatusMessage = String(localized: "Preparing secure upload…")

    for plan in plans {
      try await uploadNFCPlan(
        plan,
        via: webSocketService,
        onChunkAcknowledged: { [weak self] chunkKey, _, _, _ in
          guard let self else { return }
          if acknowledgedChunks.insert(chunkKey).inserted {
            self.nfcUploadProgress =
              Double(acknowledgedChunks.count) / Double(totalChunkCount)
          }
        }
      )
    }

    nfcUploadStatusMessage = String(localized: "Waiting for secure verification…")
    return try await completeNFCPhase(
      plans: plans,
      via: webSocketService,
      onChunkAcknowledged: { [weak self] chunkKey, _, _, _ in
        guard let self else { return }
        if acknowledgedChunks.insert(chunkKey).inserted {
          self.nfcUploadProgress =
            Double(acknowledgedChunks.count) / Double(totalChunkCount)
        }
      }
    )
  }

  func restreamNFCArtifacts(
    nfcResult: DocumentReadResult,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    let plans = try buildNFCUploadPlans(from: nfcResult)
    for plan in plans {
      try await uploadNFCPlan(plan, via: webSocketService)
    }
  }

  private func buildNfcAttestAssertion(plans: [DataUploadPlan]) async -> Data {
    func bytes(for kind: VerifyDataKind) -> Data? {
      guard let plan = plans.first(where: { $0.kind == kind }) else {
        return nil
      }
      var assembled = Data()
      for chunk in plan.chunks {
        assembled.append(chunk)
      }
      return assembled
    }

    let activeAuthSignature: Data? = {
      guard let combined = bytes(for: .activeAuth) else { return nil }
      let challengeBytes = 8
      guard combined.count > challengeBytes else { return nil }
      return combined.subdata(in: challengeBytes..<combined.count)
    }()

    let digests = NfcArtifactDigests.make(
      dg1: bytes(for: .dg1),
      dg2: bytes(for: .dg2),
      dg14: bytes(for: .dg14),
      dg15: bytes(for: .dg15),
      sod: bytes(for: .sod),
      chipAuthTranscript: bytes(for: .chipAuth),
      activeAuthSignature: activeAuthSignature
    )

    guard
      let challengeString = payload?.attestNfcChallenge,
      let challenge = Data(base64URLEncodedString: challengeString)
    else {
      return Data()
    }

    do {
      let sessionId = payload?.sessionId ?? ""
      let baseURL = APIService.baseURL(from: payload?.sessionId ?? "")
      return try await AppAttestService.shared.nfcPayloadAssertion(
        baseURL: baseURL,
        sessionId: sessionId,
        challenge: challenge,
        digests: digests
      )
    } catch {
      #if DEBUG
      print("AppAttest nfcPayloadAssertion failed: \(error.localizedDescription)")
      #endif
      return Data()
    }
  }

  private func buildNFCUploadPlans(from result: DocumentReadResult) throws -> [DataUploadPlan] {
    guard let dg1 = result.dataGroups.first(where: { $0.id == 0x61 }) else {
      throw VerificationError.missingRequiredNFCData(
        "DG1",
        documentChipName: mrzResult?.userFacingDocumentChipName ?? "document chip"
      )
    }

    guard let dg2 = result.dataGroups.first(where: { $0.id == 0x75 }) else {
      throw VerificationError.missingRequiredNFCData(
        "DG2",
        documentChipName: mrzResult?.userFacingDocumentChipName ?? "document chip"
      )
    }

    guard let sod = result.dataGroups.first(where: { $0.id == 0x77 }) else {
      throw VerificationError.missingRequiredNFCData(
        "SOD",
        documentChipName: mrzResult?.userFacingDocumentChipName ?? "document chip"
      )
    }

    var plans: [DataUploadPlan] = [
      makeNFCUploadPlan(kind: .dg1, data: dg1.data),
      makeNFCUploadPlan(kind: .dg2, data: dg2.data),
      makeNFCUploadPlan(kind: .sod, data: sod.data),
    ]

    if let dg14 = result.dataGroups.first(where: { $0.id == 0x6E }) {
      plans.append(makeNFCUploadPlan(kind: .dg14, data: dg14.data))
    }

    if let dg15 = result.dataGroups.first(where: { $0.id == 0x6F }) {
      plans.append(makeNFCUploadPlan(kind: .dg15, data: dg15.data))

      if let challenge = result.activeAuthChallenge,
        let signature = result.activeAuthSignature
      {
        var aaPayload = Data()
        aaPayload.append(challenge)
        aaPayload.append(signature)
        plans.append(makeNFCUploadPlan(kind: .activeAuth, data: aaPayload))
      }
    }

    if let chipAuthTranscript = result.chipAuthTranscript {
      plans.append(makeNFCUploadPlan(kind: .chipAuth, data: chipAuthTranscript))
    }

    return plans
  }

  private func makeNFCUploadPlan(kind: VerifyDataKind, data: Data) -> DataUploadPlan {
    DataUploadPlan(kind: kind, chunks: Self.chunkData(data, chunkSize: nfcChunkSize))
  }

  private func uploadNFCPlan(
    _ plan: DataUploadPlan,
    via webSocketService: VerifyWebSocketService,
    startingAt startChunkIndex: Int = 0,
    onChunkAcknowledged: ((String, Int, Int, VerifyDataKind) -> Void)? = nil
  ) async throws {
    try await uploadDataPlan(
      plan,
      via: webSocketService,
      startingAt: startChunkIndex,
      unexpectedResponseMessage: String(
        localized: "Unexpected NFC upload response from the server."
      ),
      onChunkAcknowledged: onChunkAcknowledged
    )
  }

  private func completeNFCPhase(
    plans: [DataUploadPlan],
    via webSocketService: VerifyWebSocketService,
    onChunkAcknowledged: ((String, Int, Int, VerifyDataKind) -> Void)? = nil
  ) async throws -> Bool {
    let nfcAssertion = await buildNfcAttestAssertion(plans: plans)

    while true {
      do {
        let response = try await webSocketService.sendPhaseAwaitResponse(
          .nfcComplete,
          error: nil,
          attestAssertion: nfcAssertion
        )

        if response.ackMessage == "phase_ok" {
          return true
        }

        if let checkResult = response.checkResult {
          handleCheckResult(checkResult)
          return false
        }

        throw VerifyWebSocketError.unexpectedServerResponse(
          describeUnexpectedServerMessage(
            response,
            fallback: String(localized: "Unexpected NFC completion response from the server.")
          )
        )
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        guard
          let missingInstruction = parseMissingNFCDataInstruction(
            errorCode: code,
            errorMessage: message
          )
        else {
          throw socketError
        }

        try await resendMissingNFCData(
          missingInstruction,
          plans: plans,
          via: webSocketService,
          onChunkAcknowledged: onChunkAcknowledged
        )
      }
    }
  }

  private func resendMissingNFCData(
    _ missingInstruction: VerifyMissingNFCDataInstruction,
    plans: [DataUploadPlan],
    via webSocketService: VerifyWebSocketService,
    onChunkAcknowledged: ((String, Int, Int, VerifyDataKind) -> Void)? = nil
  ) async throws {
    let plansByKind = Dictionary(uniqueKeysWithValues: plans.map { ($0.kind.rawValue, $0) })

    for artifact in missingInstruction.missingArtifacts {
      guard
        let kind = parseNFCArtifactKind(artifact),
        let plan = plansByKind[kind.rawValue]
      else {
        continue
      }

      try await uploadNFCPlan(
        plan,
        via: webSocketService,
        onChunkAcknowledged: onChunkAcknowledged
      )
    }

    for missingChunk in missingInstruction.missingChunks {
      guard let plan = plansByKind[missingChunk.kind] else {
        continue
      }

      let missingChunkIndices = missingChunk.missingChunkIndices.sorted()
      if missingChunkIndices.isEmpty {
        continue
      }

      for chunkIndex in missingChunkIndices {
        guard chunkIndex >= 0, chunkIndex < plan.chunks.count else {
          continue
        }

        try await uploadNFCPlan(
          plan,
          via: webSocketService,
          startingAt: chunkIndex,
          onChunkAcknowledged: onChunkAcknowledged
        )
      }
    }
  }

  private func parseNFCArtifactKind(_ artifact: String) -> VerifyDataKind? {
    switch artifact {
    case "dg1":
      return .dg1
    case "dg2":
      return .dg2
    case "sod":
      return .sod
    default:
      return nil
    }
  }

  private func beginNFCUpload(totalChunkCount: Int) {
    isUploadingNFC = true
    nfcUploadProgress = totalChunkCount > 0 ? 0 : 1
    nfcUploadStatusMessage = String(localized: "Preparing secure upload…")
  }
}
