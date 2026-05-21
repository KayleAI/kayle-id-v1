import Foundation

nonisolated func describeUnexpectedServerMessage(
  _ message: VerifyServerMessage,
  fallback: String
) -> String {
  if let ackMessage = message.ackMessage {
    return "\(fallback) Received ack '\(ackMessage)'."
  }

  if let errorCode = message.errorCode {
    let errorMessage = message.errorMessage ?? errorCode
    return "\(fallback) Received server error '\(errorCode)': \(errorMessage)"
  }

  if let checkResult = message.checkResult {
    let outcomeLabel: String
    switch checkResult.outcome {
    case .confirmed:
      outcomeLabel = "confirmed"
    case .notConfirmed:
      outcomeLabel = "not_confirmed"
    }
    return "\(fallback) Received checkResult '\(outcomeLabel)'."
  }

  if message.shareRequest != nil {
    return "\(fallback) Received a share request."
  }

  if message.shareReady != nil {
    return "\(fallback) Received a share-ready confirmation."
  }

  return fallback
}
