import Foundation

extension VerificationSession {
  func waitForPendingPhaseUpdates() async {
    let task = pendingPhaseUpdateTask
    await task?.value
  }

  func waitForLivenessUploadTurn() async throws {
    if !livenessUploadInFlight {
      livenessUploadInFlight = true
      return
    }
    try await withCheckedThrowingContinuation { continuation in
      livenessUploadWaiters.append(continuation)
    }
  }

  func releaseLivenessUploadSlot() {
    if livenessUploadWaiters.isEmpty {
      livenessUploadInFlight = false
      return
    }
    let next = livenessUploadWaiters.removeFirst()
    next.resume()
  }

  func cancelLivenessUploadWaiters() {
    let waiters = livenessUploadWaiters
    livenessUploadWaiters = []
    livenessUploadInFlight = false
    for waiter in waiters {
      waiter.resume(throwing: CancellationError())
    }
  }

  func resetNFCUploadState() {
    isUploadingNFC = false
    nfcUploadProgress = 0
    nfcUploadStatusMessage = nil
  }
}
