import Foundation

enum VerifyWebSocketError: LocalizedError {
  case notConnected
  case invalidURL
  case sendFailed
  case sendFailedWithReason(String)
  case connectionClosed
  case helloTimedOut
  case serverResponseTimedOut
  case serverError(code: String, message: String)
  case unexpectedServerResponse(String)
  case reconnectFailed

  var errorDescription: String? {
    switch self {
    case .notConnected:
      return "WebSocket not connected."
    case .invalidURL:
      return "Invalid WebSocket URL."
    case .sendFailed:
      return "Failed to send WebSocket message."
    case .sendFailedWithReason(let message):
      return "Failed to send WebSocket message: \(message)"
    case .connectionClosed:
      return "WebSocket connection closed unexpectedly."
    case .helloTimedOut:
      return "Timed out waiting for verification handshake."
    case .serverResponseTimedOut:
      return "Timed out waiting for verification server response."
    case .serverError(_, let message):
      return message
    case .unexpectedServerResponse(let message):
      return message
    case .reconnectFailed:
      return "Failed to reconnect verification session."
    }
  }

  var serverErrorCode: String? {
    if case .serverError(let code, _) = self {
      return code
    }
    return nil
  }

  var isNonRetryableAuthFailure: Bool {
    guard let code = serverErrorCode else {
      return false
    }
    return isNonRetryableAuthErrorCode(code)
  }
}

enum VerifyHelloResponse: Equatable {
  case success
  case failure(code: String, message: String)
}

enum VerifyCheckOutcome: Equatable {
  case confirmed
  case notConfirmed
}

enum VerifyCheckKind: Int32, Equatable {
  case mrz = 0
  case nfc = 1
  case liveness = 2
  case none = 3
}

struct VerifyServerCheckResult: Equatable {
  let outcome: VerifyCheckOutcome
  let reasonCode: String
  let reasonMessage: String
  let retryAllowed: Bool
  let failedCheck: VerifyCheckKind
  let remainingNfcRetries: Int
  let remainingLivenessRetries: Int
}

struct VerifyShareRequestField: Equatable, Identifiable {
  let key: String
  let reason: String
  let required: Bool

  var id: String {
    key
  }
}

struct VerifyShareRequest: Equatable {
  let contractVersion: Int
  let sessionId: String
  let fields: [VerifyShareRequestField]
}

struct VerifyShareReady: Equatable {
  let sessionId: String
  let selectedFieldKeys: [String]
}

struct VerifySharePreviewContext: Equatable {
  let birthDate: String?
  let documentNumber: String?
  let documentType: String?
  let expiryDate: String?
  let givenNames: String?
  let issuingCountry: String?
  let nationality: String?
  let optionalData: String?
  let sex: String?
  let surname: String?
}

struct VerifyChunkRetryInstruction: Equatable {
  let kind: Int
  let index: Int
  let chunkIndex: Int
  let reason: String
}

struct VerifyMissingNFCChunk: Equatable {
  let kind: Int
  let index: Int
  let chunkTotal: Int?
  let missingChunkIndices: [Int]
}

struct VerifyMissingNFCDataInstruction: Equatable {
  let missingArtifacts: [String]
  let missingChunks: [VerifyMissingNFCChunk]
}

struct VerifyMissingLivenessDataInstruction: Equatable {
  let receivedBytes: Int
  let missingChunks: [VerifyMissingNFCChunk]
}

nonisolated func isExpectedDataAck(
  ackMessage: String?,
  kind: Int,
  index: Int,
  chunkIndex: Int,
  chunkTotal: Int
) -> Bool {
  guard let ackMessage else {
    return false
  }

  if chunkTotal <= 1 {
    return ackMessage == "data_ok_\(kind)_\(index)"
  }

  let chunkAck = "data_chunk_ok_\(kind)_\(index)_\(chunkIndex)"
  let finalAck = "data_ok_\(kind)_\(index)"
  return ackMessage == chunkAck ||
    (chunkIndex == chunkTotal - 1 && ackMessage == finalAck)
}

nonisolated func isExpectedPhaseAck(_ ackMessage: String?) -> Bool {
  ackMessage == "phase_ok"
}

nonisolated func parseChunkRetryInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyChunkRetryInstruction? {
  guard errorCode == "DATA_CHUNK_RETRY", let errorMessage else {
    return nil
  }

  guard
    let json = parseInstructionPayload(errorMessage),
    let kind = json["kind"] as? Int,
    let index = json["index"] as? Int,
    let chunkIndex = json["chunkIndex"] as? Int
  else {
    return nil
  }

  let reason = json["reason"] as? String ?? "unknown"
  return VerifyChunkRetryInstruction(
    kind: kind,
    index: index,
    chunkIndex: chunkIndex,
    reason: reason
  )
}

nonisolated func parseMissingNFCDataInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyMissingNFCDataInstruction? {
  guard errorCode == "NFC_REQUIRED_DATA_MISSING", let errorMessage else {
    return nil
  }

  guard let json = parseInstructionPayload(errorMessage) else {
    return nil
  }

  let missingArtifacts = json["missing_artifacts"] as? [String] ?? []

  return VerifyMissingNFCDataInstruction(
    missingArtifacts: missingArtifacts,
    missingChunks: parseMissingChunks(json)
  )
}

nonisolated func parseMissingLivenessDataInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyMissingLivenessDataInstruction? {
  guard errorCode == "LIVENESS_REQUIRED_DATA_MISSING", let errorMessage else {
    return nil
  }

  guard let json = parseInstructionPayload(errorMessage) else {
    return nil
  }

  let receivedBytes = json["received_bytes"] as? Int ?? 0

  return VerifyMissingLivenessDataInstruction(
    receivedBytes: receivedBytes,
    missingChunks: parseMissingChunks(json)
  )
}

nonisolated private func parseInstructionPayload(
  _ errorMessage: String
) -> [String: Any]? {
  guard let data = errorMessage.data(using: .utf8) else {
    return nil
  }

  return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

nonisolated private func parseMissingChunks(
  _ json: [String: Any]
) -> [VerifyMissingNFCChunk] {
  let rawChunks = json["missing_chunks"] as? [[String: Any]] ?? []
  return rawChunks.compactMap { chunk in
    guard
      let kind = chunk["kind"] as? Int,
      let index = chunk["index"] as? Int
    else {
      return nil
    }

    let chunkTotal = chunk["chunk_total"] as? Int
    let missingChunkIndices = chunk["missing_chunk_indices"] as? [Int] ?? []
    return VerifyMissingNFCChunk(
      kind: kind,
      index: index,
      chunkTotal: chunkTotal,
      missingChunkIndices: missingChunkIndices
    )
  }
}

nonisolated func parseHelloResponse(
  ackMessage: String?,
  errorCode: String?,
  errorMessage: String?
) -> VerifyHelloResponse? {
  if let code = errorCode, !code.isEmpty {
    return .failure(code: code, message: errorMessage ?? code)
  }

  if ackMessage == "hello_ok" {
    return .success
  }

  return nil
}

nonisolated func isConfirmedCheck(_ checkResult: VerifyServerCheckResult?) -> Bool {
  guard let checkResult else {
    return false
  }

  switch checkResult.outcome {
  case .confirmed:
    return true
  case .notConfirmed:
    return false
  }
}

nonisolated func isNotConfirmedCheck(_ checkResult: VerifyServerCheckResult?) -> Bool {
  guard let checkResult else {
    return false
  }

  switch checkResult.outcome {
  case .confirmed:
    return false
  case .notConfirmed:
    return true
  }
}

nonisolated func shouldSuppressReconnectAfterHandledCheckResult(
  _ checkResult: VerifyServerCheckResult?
) -> Bool {
  isNotConfirmedCheck(checkResult)
}

nonisolated func isNonRetryableAuthErrorCode(_ code: String) -> Bool {
  switch code {
  case "HELLO_AUTH_REQUIRED",
    "ATTEMPT_NOT_FOUND",
    "HANDOFF_TOKEN_INVALID",
    "HANDOFF_TOKEN_EXPIRED",
    "HANDOFF_TOKEN_CONSUMED",
    "HANDOFF_DEVICE_MISMATCH",
    "HELLO_ATTEST_INVALID",
    "HELLO_ATTEST_KEY_UNKNOWN",
    "MIN_APP_VERSION_REQUIRED":
    return true
  default:
    return false
  }
}

nonisolated func isVerificationSessionConnectionLoss(
  _ error: VerifyWebSocketError
) -> Bool {
  switch error {
  case .connectionClosed,
    .notConnected,
    .sendFailed,
    .sendFailedWithReason,
    .helloTimedOut,
    .serverResponseTimedOut,
    .reconnectFailed:
    return true
  default:
    return false
  }
}

nonisolated func shouldRetryReconnect(
  isAuthenticated: Bool,
  lastErrorCode: String?,
  attempt: Int,
  maxAttempts: Int
) -> Bool {
  guard isAuthenticated, attempt > 0, attempt <= maxAttempts else {
    return false
  }

  if let code = lastErrorCode, isNonRetryableAuthErrorCode(code) {
    return false
  }

  return true
}
