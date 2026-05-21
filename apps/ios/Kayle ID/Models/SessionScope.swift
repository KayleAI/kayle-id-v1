nonisolated func shouldHandleSessionScopedEvent(
  currentSessionId: String?,
  eventSessionId: String?
) -> Bool {
  guard let currentSessionId else {
    return false
  }

  guard let eventSessionId else {
    return true
  }

  return currentSessionId == eventSessionId
}

nonisolated func shouldPreventDeviceSleepDuringVerification(
  hasActiveSession: Bool,
  isTerminalStep: Bool
) -> Bool {
  hasActiveSession && !isTerminalStep
}
