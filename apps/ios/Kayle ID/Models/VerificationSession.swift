import Combine
import Foundation
import SwiftUI

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

  if let verdict = message.verdict {
    let outcomeLabel: String
    switch verdict.outcome {
    case .accepted:
      outcomeLabel = "accepted"
    case .rejected:
      outcomeLabel = "rejected"
    }
    return "\(fallback) Received verdict '\(outcomeLabel)'."
  }

  if message.shareRequest != nil {
    return "\(fallback) Received a share request."
  }

  if message.shareReady != nil {
    return "\(fallback) Received a share-ready confirmation."
  }

  return fallback
}

/// Observable session state for the verification flow.
@MainActor
final class VerificationSession: ObservableObject {
  @Published var step: VerificationStep = .welcome
  @Published var payload: QRCodePayload?
  @Published var errorMessage: String?
  @Published var isRetryingVerification = false
  @Published var isReconnecting = false
  /// Bumped whenever the liveness session must restart from scratch (e.g. after
  /// a reconnect). Applied as `.id()` to the LivenessCaptureView so SwiftUI
  /// remounts it and resets its internal isRecording/buffered state,
  /// instead of leaving the "Uploading…" overlay stuck on screen.
  @Published var livenessCaptureGeneration = UUID()
  @Published var verdict: VerifyServerVerdict?
  @Published var shareRequest: VerifyShareRequest?
  @Published var selectedShareFieldKeys = Set<String>()
  @Published var shareSelectionErrorMessage: String?
  @Published var isSubmittingShareSelection = false
  @Published var isUploadingNFC = false
  @Published var nfcUploadStatusMessage: String?
  @Published var nfcUploadProgress: Double = 0

  // Captured data
  @Published var mrzResult: MRZResult?
  @Published var nfcResult: DocumentReadResult?
  @Published var livenessVideoURL: URL?
  @Published var hasRFIDSymbol: Bool?
  /// AA challenge issued by the server. Set asynchronously after hello — must
  /// be threaded into the MRTDReader configuration so the chip signs *this*
  /// nonce, not one the client picked. Closes the Challenge Semantics
  /// weakness from ICAO 9303 Part 11 §6.1.
  @Published var activeAuthChallenge: Data?
  /// Head-movement pose challenge issued by the server at the
  /// nfc_complete → liveness_capturing transition. Drives the on-screen
  /// prompts in `LivenessCaptureView`.
  @Published var livenessChallenge: VerifyServerLivenessChallenge?

  // Services
  private var webSocketService: VerifyWebSocketService?
  private var livenessUploadStarted = false
  private var livenessUploadComplete = false
  private var livenessVideoBytes: Data?
  private var livenessUploadCancelled = false
  private var livenessUploadInFlight = false
  // Queue of upload calls waiting for the slot to free. Resumed
  // one-at-a-time in FIFO order by `releaseLivenessUploadSlot`, or
  // resumed with CancellationError on teardown so parked callers
  // unwind cleanly instead of waking up on a stale session.
  private var livenessUploadWaiters: [CheckedContinuation<Void, Error>] = []
  private var pendingPhaseUpdateTask: Task<Void, Never>?
  private var reconnectTask: Task<Void, Never>?
  private let nfcChunkSize = 64 * 1024
  private let livenessChunkSize = 128 * 1024
  private let maxReconnectAttempts = 5
  // 1s base, exponential up to ~16s — total budget ~30s before giving up.
  private let reconnectBaseDelayNs: UInt64 = 1_000_000_000

  private struct NFCUploadPlan {
    let kind: VerifyDataKind
    let chunks: [Data]
  }

  private struct LivenessUploadPlan {
    let chunks: [Data]
  }

  /// Initialize a new session from a scanned QR code payload.
  func initialize(with payload: QRCodePayload) async throws {
    guard payload.isValid else {
      throw QRCodePayloadError.invalidPayload
    }

    teardownAttemptState(clearPayload: true)
    try await bootstrapAttempt(with: payload)
  }

  /// Update the current phase on the server.
  func updatePhase(_ phase: AttemptPhase, error: String? = nil) async {
    queuePhaseUpdate(phase, error: error)
  }
  
  /// Upload MRZ data immediately after MRZ scan completes.
  func uploadMRZData() async throws {
    // MRZ data is only used locally for NFC access; no upload needed.
    guard mrzResult != nil else {
      throw VerificationError.notInitialized
    }
  }
  
  /// Upload NFC data immediately after NFC read completes.
  func uploadNFCData() async throws -> Bool {
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
    await Task.yield()
    await waitForPendingPhaseUpdates()
    nfcUploadStatusMessage = String(localized: "Reconnecting to continue secure upload…")
    try await webSocketService.reconnectForTransfer()
    nfcUploadStatusMessage = String(localized: "Preparing secure upload…")

    do {
      for plan in plans {
        try await uploadNFCPlan(
          plan,
          via: webSocketService,
          onChunkAcknowledged: { [weak self] chunkKey, chunkIndex, chunkTotal, kind in
            guard let self else { return }
            if acknowledgedChunks.insert(chunkKey).inserted {
              self.nfcUploadProgress =
                Double(acknowledgedChunks.count) / Double(totalChunkCount)
            }
          }
        )
      }

      nfcUploadStatusMessage = String(localized: "Waiting for secure verification…")
      let shouldContinue = try await completeNFCPhase(
        plans: plans,
        via: webSocketService,
        onChunkAcknowledged: { [weak self] chunkKey, chunkIndex, chunkTotal, kind in
          guard let self else { return }
          if acknowledgedChunks.insert(chunkKey).inserted {
            self.nfcUploadProgress =
              Double(acknowledgedChunks.count) / Double(totalChunkCount)
          }
        }
      )
      resetNFCUploadState()
      return shouldContinue
    } catch {
      resetNFCUploadState()
      throw error
    }
  }
  
  /// Upload the head-movement liveness video and advance to liveness_complete.
  /// Returns the recorded verdict (accepted or rejected) once the server has
  /// run the liveness + face match validation.
  func sendLivenessVideo(_ videoURL: URL) async throws -> Bool {
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

    let videoBytes: Data
    do {
      videoBytes = try Data(contentsOf: videoURL, options: .mappedIfSafe)
    } catch {
      throw LivenessError.videoReadFailed
    }

    guard !videoBytes.isEmpty else {
      throw LivenessError.videoEmpty
    }

    livenessVideoBytes = videoBytes
    livenessUploadStarted = true

    let plan = buildLivenessUploadPlan(from: videoBytes)
    try await uploadLivenessPlan(plan, via: webSocketService)
    try await completeLivenessPhase(plan: plan, via: webSocketService)
    livenessUploadComplete = true
    return true
  }

  /// Move to the next step in the flow.
  func moveToStep(_ newStep: VerificationStep) {
    step = newStep
  }

  func syncCompletedMRZScan() {
    Task { @MainActor in
      await updatePhase(.mrzComplete)

      do {
        try await uploadMRZData()
      } catch {
#if DEBUG
        print("Failed to finalize MRZ scan: \(error.localizedDescription)")
#endif
      }
    }
  }

  /// Handle an error during verification.
  func handleError(_ error: Error, forAttemptId attemptId: String? = nil) {
    handleError(error, forAttemptId: attemptId, attemptReconnect: true)
  }

  private func handleError(
    _ error: Error,
    forAttemptId attemptId: String?,
    attemptReconnect: Bool
  ) {
    if let attemptId {
      guard
        shouldHandleAttemptScopedEvent(
          currentAttemptId: payload?.attemptId,
          eventAttemptId: attemptId
        )
      else {
        return
      }
    }

    guard step != .error else {
      return
    }

    let socketError = error as? VerifyWebSocketError
    let isTransientConnectionLoss =
      socketError.map { isVerificationSessionConnectionLoss($0) } ?? false
    let isAuthFailure = socketError?.isNonRetryableAuthFailure ?? false

    // Transient socket drops (background, network blip, idle close) lose state
    // the user has built up — scanned QR, captured MRZ, etc. Re-handshake
    // instead of dumping them on the "Start Again" screen. Only fall through
    // to the terminal error UI when reconnection isn't viable (no payload to
    // resume, step isn't reconnectable, or the failure is a permanent auth
    // rejection).
    if
      attemptReconnect,
      isTransientConnectionLoss,
      !isAuthFailure,
      let activePayload = payload,
      isVerificationStepReconnectable(step)
    {
      if !isReconnecting {
        scheduleReconnect(forAttemptId: attemptId ?? activePayload.attemptId)
      }
      return
    }

    let resolvedError = resolveDisplayError(error)
    let terminalAttemptId = attemptId ?? payload?.attemptId
    reconnectTask?.cancel()
    reconnectTask = nil
    isReconnecting = false
    verdict = nil
    errorMessage = resolvedError.localizedDescription
    isRetryingVerification = false
    step = .error
    livenessUploadCancelled = true

    Task { @MainActor [weak self] in
      guard let self else { return }
      await updatePhase(.error, error: resolvedError.localizedDescription)
      await waitForPendingPhaseUpdates()
      guard let terminalAttemptId else { return }

      guard
        shouldHandleAttemptScopedEvent(
          currentAttemptId: self.payload?.attemptId,
          eventAttemptId: terminalAttemptId
        )
      else {
        return
      }

      self.closeActiveAttemptConnection()
    }
  }

  func handleRetryError(_ error: Error, forAttemptId attemptId: String? = nil) {
    if let attemptId {
      guard
        shouldHandleAttemptScopedEvent(
          currentAttemptId: payload?.attemptId,
          eventAttemptId: attemptId
        )
      else {
        return
      }
    }

    let resolvedError = resolveDisplayError(error)
    errorMessage = String(
      localized: "Retry could not start. \(resolvedError.localizedDescription)"
    )
    isRetryingVerification = false
    step = .complete
  }

  /// Reset the session for a new verification attempt.
  func reset() {
    step = .welcome
    teardownAttemptState(clearPayload: true)
  }

  func retryVerification() async throws {
    guard let currentPayload = payload else {
      throw VerificationError.notInitialized
    }

    errorMessage = nil
    isRetryingVerification = true
    let nextPayload = try await fetchFreshHandoffPayload(
      sessionId: currentPayload.sessionId
    )

    try await bootstrapAttempt(with: nextPayload)
    moveToStep(.mrz)
  }

  func cancelVerification() async throws {
    guard let currentPayload = payload else {
      throw VerificationError.notInitialized
    }

    // The cancel endpoint requires the one-shot cancel_token that the verify
    // browser embedded into the handoff QR payload. If the user scanned an
    // older QR that pre-dates the cancel-token rollout, we have nothing to
    // authenticate with — bail silently so the session naturally expires
    // server-side instead of throwing an unactionable error to the user.
    guard let cancelToken = currentPayload.cancelToken else {
      return
    }

    try await APIService.cancelVerification(
      sessionId: currentPayload.sessionId,
      cancelToken: cancelToken
    )
  }

  func clearDocumentCaptureState() {
    mrzResult = nil
    nfcResult = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessChallenge = nil
    hasRFIDSymbol = nil
    resetNFCUploadState()
  }

  private func fetchFreshHandoffPayload(sessionId: String) async throws -> QRCodePayload {
    let nextPayload = try await APIService.fetchHandoffPayload(sessionId: sessionId)

    guard nextPayload.isValid else {
      throw QRCodePayloadError.invalidPayload
    }

    return nextPayload
  }

  private func bootstrapAttempt(with payload: QRCodePayload) async throws {
    let service = makeWebSocketService(for: payload)

    do {
      try service.connect()
      try await service.sendHello()
    } catch {
      service.disconnect()
      throw error
    }

    let activeWebSocketService = webSocketService
    resetAttemptState(clearPayload: false)
    activeWebSocketService?.disconnect()
    self.payload = payload
    webSocketService = service
    await updatePhase(.mobileConnected)
  }

  private func makeWebSocketService(
    for payload: QRCodePayload
  ) -> VerifyWebSocketService {
    let baseURL = APIService.baseURL(from: payload.sessionId)
    let attemptId = payload.attemptId
    let attestChallenge = payload.attestHelloChallenge
      .flatMap { Data(base64URLEncodedString: $0) }

    return VerifyWebSocketService(
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      mobileWriteToken: payload.mobileWriteToken,
      baseURL: baseURL,
      attestHelloChallenge: attestChallenge,
      onFatalError: { [weak self] socketError in
        Task { @MainActor [weak self] in
          guard let self else { return }
          guard
            shouldHandleAttemptScopedEvent(
              currentAttemptId: self.payload?.attemptId,
              eventAttemptId: attemptId
            )
          else {
            return
          }
          self.handleError(socketError, forAttemptId: attemptId)
        }
      },
      onShareRequest: { [weak self] shareRequest in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleAttemptScopedEvent(
              currentAttemptId: self.payload?.attemptId,
              eventAttemptId: attemptId
            )
          else {
            return
          }
          self.handleShareRequest(shareRequest)
        }
      },
      onActiveAuthChallenge: { [weak self] challenge in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleAttemptScopedEvent(
              currentAttemptId: self.payload?.attemptId,
              eventAttemptId: attemptId
            )
          else {
            return
          }
          self.activeAuthChallenge = challenge
        }
      },
      onLivenessChallenge: { [weak self] challenge in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleAttemptScopedEvent(
              currentAttemptId: self.payload?.attemptId,
              eventAttemptId: attemptId
            )
          else {
            return
          }
          self.livenessChallenge = challenge
        }
      }
    )
  }

  private func resetAttemptState(clearPayload: Bool) {
    if clearPayload {
      payload = nil
    }

    verdict = nil
    errorMessage = nil
    isRetryingVerification = false
    isReconnecting = false
    shareRequest = nil
    selectedShareFieldKeys = []
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    mrzResult = nil
    nfcResult = nil
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessChallenge = nil
    hasRFIDSymbol = nil
    webSocketService = nil
    livenessUploadStarted = false
    livenessUploadComplete = false
    livenessUploadCancelled = false
    cancelLivenessUploadWaiters()
    resetNFCUploadState()
    pendingPhaseUpdateTask?.cancel()
    pendingPhaseUpdateTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
  }

  private func teardownAttemptState(clearPayload: Bool) {
    let activeWebSocketService = webSocketService
    resetAttemptState(clearPayload: clearPayload)
    activeWebSocketService?.disconnect()
  }

  private func closeActiveAttemptConnection() {
    let activeWebSocketService = webSocketService
    webSocketService = nil
    pendingPhaseUpdateTask?.cancel()
    pendingPhaseUpdateTask = nil
    reconnectTask?.cancel()
    reconnectTask = nil
    isReconnecting = false
    resetNFCUploadState()
    activeWebSocketService?.disconnect()
  }

  private func scheduleReconnect(forAttemptId attemptId: String) {
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
          activePayload.attemptId == attemptId
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

      // Reconnect exhausted — clear the reconnecting flag and route to the
      // terminal error UI. Pass attemptReconnect:false so handleError doesn't
      // loop back into scheduleReconnect for the same connection-loss error.
      self.isReconnecting = false
      self.reconnectTask = nil
      self.handleError(
        lastError ?? VerifyWebSocketError.reconnectFailed,
        forAttemptId: attemptId,
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

    // The server's per-socket VerifyTransferState resets on reconnect, so any
    // chunks in flight over the previous socket are gone; clear upload
    // bookkeeping so the next retap streams cleanly. mrzResult, nfcResult,
    // and activeAuthChallenge survive because the AA challenge is
    // deterministic per attemptId — the chip-signed bytes in nfcResult are
    // still valid against the re-derived expectedChallenge. livenessVideoURL
    // does NOT survive: an interrupted liveness session must be restarted
    // from scratch, so the user is sent back through the capture flow rather
    // than resuming against stale partial state. The pose challenge survives
    // because deriveLivenessChallenge is deterministic per attemptId — the
    // server will re-issue the same sequence on the new socket.
    resetNFCUploadState()
    livenessVideoURL = nil
    livenessVideoBytes = nil
    livenessUploadStarted = false
    livenessUploadComplete = false
    livenessUploadCancelled = false
    cancelLivenessUploadWaiters()
    livenessCaptureGeneration = UUID()

    // Re-stream NFC artifacts so the server can face-match against dg2.
    // Without this, the next phase=liveness_complete would silently advance
    // with empty transfer state because face validation early-returns when
    // dg2 is missing, leaving the attempt in a corrupted phase.
    if let nfcResult {
      try await restreamNFCArtifacts(
        nfcResult: nfcResult,
        via: service
      )
    }
  }

  /// Re-push the cached NFC artifacts onto a freshly connected socket. Used
  /// from the reconnect path (proactive) and from a server-issued
  /// NFC_REQUIRED_DATA_MISSING on liveness_complete (reactive). Bytes are the
  /// same ones the chip signed; AA/CA signatures still verify against the
  /// server's deterministic per-attempt challenge, so this is a pure replay
  /// of validated material, not a fresh trust decision.
  private func restreamNFCArtifacts(
    nfcResult: DocumentReadResult,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    let plans = try buildNFCUploadPlans(from: nfcResult)
    for plan in plans {
      try await uploadNFCPlan(plan, via: webSocketService)
    }
  }

  private func handleVerdict(_ verdict: VerifyServerVerdict) {
    self.verdict = verdict
    errorMessage = nil
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    livenessUploadCancelled = isRejectedVerdict(verdict)

    if isRejectedVerdict(verdict) {
      closeActiveAttemptConnection()
      shareRequest = nil
      selectedShareFieldKeys = []
      moveToStep(.complete)
    }
  }

  private func handleShareRequest(_ shareRequest: VerifyShareRequest) {
    self.shareRequest = shareRequest
    selectedShareFieldKeys = defaultSelectedShareFieldKeys(shareRequest)
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    moveToStep(.shareDetails)
  }

  func isShareFieldSelected(_ key: String) -> Bool {
    selectedShareFieldKeys.contains(key)
  }

  func setShareFieldSelected(_ key: String, isSelected: Bool) {
    guard
      let field = shareRequest?.fields.first(where: { $0.key == key }),
      !isShareFieldSelectionLocked(field)
    else {
      return
    }

    if isSelected {
      selectedShareFieldKeys.insert(key)
      return
    }

    selectedShareFieldKeys.remove(key)
  }

  func canSubmitShareSelection() -> Bool {
    isShareSelectionSubmittable(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
  }

  func canSelectAllAvailableShareFields() -> Bool {
    hasUnselectedOptionalShareFields(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
  }

  func selectAllAvailableShareFields() {
    selectedShareFieldKeys = selectedShareFieldKeysIncludingAllOptionalFields(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
    shareSelectionErrorMessage = nil
  }

  func submitShareSelection() async {
    guard let shareRequest, let webSocketService else {
      handleError(VerificationError.notInitialized)
      return
    }

    let orderedSelectedFieldKeys = orderedSelectedShareFieldKeys(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )

    guard !orderedSelectedFieldKeys.isEmpty else {
      shareSelectionErrorMessage = String(
        localized: "Choose at least one verification detail before continuing."
      )
      return
    }

    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = true

    do {
      let response = try await webSocketService.sendShareSelectionAwaitResponse(
        sessionId: shareRequest.sessionId,
        selectedFieldKeys: orderedSelectedFieldKeys
      )

      if let shareReady = response.shareReady {
        selectedShareFieldKeys = Set(shareReady.selectedFieldKeys)
        isSubmittingShareSelection = false
        closeActiveAttemptConnection()
        moveToStep(.complete)
        return
      }

      throw VerifyWebSocketError.unexpectedServerResponse(
        describeUnexpectedServerMessage(
          response,
          fallback: String(
            localized: "Unexpected share selection response from the server."
          )
        )
      )
    } catch let socketError as VerifyWebSocketError {
      isSubmittingShareSelection = false

      if case .serverError(_, let message) = socketError {
        shareSelectionErrorMessage = message
        return
      }

      handleError(socketError)
    } catch {
      isSubmittingShareSelection = false
      handleError(error)
    }
  }

  private func buildLivenessUploadPlan(from videoBytes: Data) -> LivenessUploadPlan {
    LivenessUploadPlan(
      chunks: chunkData(videoBytes, chunkSize: livenessChunkSize)
    )
  }

  private func uploadLivenessPlan(
    _ plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService,
    startingAt startChunkIndex: Int = 0
  ) async throws {
    guard !plan.chunks.isEmpty else {
      throw VerificationError.uploadFailed
    }

    let clampedStartChunkIndex = max(0, min(startChunkIndex, plan.chunks.count - 1))
    var nextChunkIndex = clampedStartChunkIndex
    let chunkTotal = plan.chunks.count

    while nextChunkIndex < chunkTotal {
      if livenessUploadCancelled {
        throw LivenessError.uploadFailed
      }

      do {
        let response = try await webSocketService.sendDataAwaitResponse(
          kind: .livenessVideo,
          raw: plan.chunks[nextChunkIndex],
          index: 0,
          total: 1,
          chunkIndex: nextChunkIndex,
          chunkTotal: chunkTotal
        )

        guard
          isExpectedDataAck(
            ackMessage: response.ackMessage,
            kind: VerifyDataKind.livenessVideo.rawValue,
            index: 0,
            chunkIndex: nextChunkIndex,
            chunkTotal: chunkTotal
          )
        else {
          throw VerifyWebSocketError.unexpectedServerResponse(
            describeUnexpectedServerMessage(
              response,
              fallback: String(
                localized:
                  "Unexpected liveness upload response from the server."
              )
            )
          )
        }

        nextChunkIndex += 1
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        guard
          let retryInstruction = parseChunkRetryInstruction(
            errorCode: code,
            errorMessage: message
          ),
          retryInstruction.kind == VerifyDataKind.livenessVideo.rawValue,
          retryInstruction.index == 0,
          retryInstruction.chunkIndex >= 0,
          retryInstruction.chunkIndex < chunkTotal
        else {
          throw socketError
        }

        nextChunkIndex = retryInstruction.chunkIndex
      }
    }
  }

  private func completeLivenessPhase(
    plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    while true {
      do {
        let response = try await webSocketService.sendPhaseAwaitResponse(
          .livenessComplete,
          error: nil
        )

        if let verdict = response.verdict {
          handleVerdict(verdict)
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

        // Server-side transfer state can be missing NFC bytes if the socket
        // reconnected and the proactive re-stream hasn't run (or was raced).
        // Re-stream the cached NFC artifacts and retry liveness_complete.
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

  private func resendMissingLivenessData(
    _ missingInstruction: VerifyMissingLivenessDataInstruction,
    plan: LivenessUploadPlan,
    via webSocketService: VerifyWebSocketService
  ) async throws {
    // Liveness is a single artifact (index=0, total=1). If the server says
    // nothing arrived (receivedBytes=0 and missingChunks describes the full
    // payload) replay the whole plan; otherwise, replay just the requested
    // chunk indices.
    if missingInstruction.missingChunks.isEmpty {
      try await uploadLivenessPlan(plan, via: webSocketService)
      return
    }

    for missingChunk in missingInstruction.missingChunks {
      guard missingChunk.kind == VerifyDataKind.livenessVideo.rawValue else {
        continue
      }

      for chunkIndex in missingChunk.missingChunkIndices.sorted() {
        guard chunkIndex >= 0, chunkIndex < plan.chunks.count else {
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

  /// Build the App Attest assertion that binds this NFC payload to the
  /// hardware-attested key. The server recomputes the same digest from the
  /// uploaded artifacts before calling verifyAssertion, so the byte order
  /// MUST match `apps/api/src/v1/verify/attest-gate.ts buildNfcClientDataHash`
  /// exactly: dg1, dg2, dg14, dg15, sod, chipAuthTranscript, activeAuthSignature.
  private func buildNfcAttestAssertion(plans: [NFCUploadPlan]) async -> Data {
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

    // The activeAuth plan packs `challenge ‖ signature`; the server only
    // hashes the signature half (challenge is server-issued and known to it).
    let activeAuthSignature: Data? = {
      guard let combined = bytes(for: .activeAuth) else { return nil }
      // The challenge is 8 bytes (ICAO), signature is the remainder.
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
      let attemptId = payload?.attemptId ?? ""
      let baseURL = APIService.baseURL(from: payload?.sessionId ?? "")
      return try await AppAttestService.shared.nfcPayloadAssertion(
        baseURL: baseURL,
        attemptId: attemptId,
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

  private func buildNFCUploadPlans(from result: DocumentReadResult) throws -> [NFCUploadPlan] {
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

    var plans: [NFCUploadPlan] = [
      NFCUploadPlan(kind: .dg1, chunks: chunkData(dg1.data, chunkSize: nfcChunkSize)),
      NFCUploadPlan(kind: .dg2, chunks: chunkData(dg2.data, chunkSize: nfcChunkSize)),
      NFCUploadPlan(kind: .sod, chunks: chunkData(sod.data, chunkSize: nfcChunkSize)),
    ]

    if let dg14 = result.dataGroups.first(where: { $0.id == 0x6E }) {
      plans.append(NFCUploadPlan(kind: .dg14, chunks: chunkData(dg14.data, chunkSize: nfcChunkSize)))
    }

    if let dg15 = result.dataGroups.first(where: { $0.id == 0x6F }) {
      plans.append(NFCUploadPlan(kind: .dg15, chunks: chunkData(dg15.data, chunkSize: nfcChunkSize)))

      if let challenge = result.activeAuthChallenge,
         let signature = result.activeAuthSignature {
        var aaPayload = Data()
        aaPayload.append(challenge)
        aaPayload.append(signature)
        plans.append(NFCUploadPlan(kind: .activeAuth, chunks: chunkData(aaPayload, chunkSize: nfcChunkSize)))
      }
    }

    if let chipAuthTranscript = result.chipAuthTranscript {
      plans.append(NFCUploadPlan(kind: .chipAuth, chunks: chunkData(chipAuthTranscript, chunkSize: nfcChunkSize)))
    }

    return plans
  }

  private func chunkData(_ raw: Data, chunkSize: Int) -> [Data] {
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

  private func uploadNFCPlan(
    _ plan: NFCUploadPlan,
    via webSocketService: VerifyWebSocketService,
    startingAt startChunkIndex: Int = 0,
    onChunkAcknowledged: ((String, Int, Int, VerifyDataKind) -> Void)? = nil
  ) async throws {
    guard !plan.chunks.isEmpty else {
      throw VerificationError.uploadFailed
    }

    let clampedStartChunkIndex = max(0, min(startChunkIndex, plan.chunks.count - 1))
    var nextChunkIndex = clampedStartChunkIndex
    let chunkTotal = plan.chunks.count

    while nextChunkIndex < chunkTotal {
      let chunk = plan.chunks[nextChunkIndex]

      do {
        let response = try await webSocketService.sendDataAwaitResponse(
          kind: plan.kind,
          raw: chunk,
          index: 0,
          total: 1,
          chunkIndex: nextChunkIndex,
          chunkTotal: chunkTotal
        )

        guard
          isExpectedDataAck(
            ackMessage: response.ackMessage,
            kind: plan.kind.rawValue,
            index: 0,
            chunkIndex: nextChunkIndex,
            chunkTotal: chunkTotal
          )
        else {
          throw VerifyWebSocketError.unexpectedServerResponse(
            describeUnexpectedServerMessage(
              response,
              fallback: String(
                localized: "Unexpected NFC upload response from the server."
              )
            )
          )
        }

        let chunkKey = "\(plan.kind.rawValue)-0-\(nextChunkIndex)"
        onChunkAcknowledged?(chunkKey, nextChunkIndex, chunkTotal, plan.kind)
        nextChunkIndex += 1
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        guard
          let retryInstruction = parseChunkRetryInstruction(
            errorCode: code,
            errorMessage: message
          ),
          retryInstruction.kind == plan.kind.rawValue,
          retryInstruction.index == 0,
          retryInstruction.chunkIndex >= 0,
          retryInstruction.chunkIndex < chunkTotal
        else {
          throw socketError
        }

        nextChunkIndex = retryInstruction.chunkIndex
      }
    }
  }

  private func completeNFCPhase(
    plans: [NFCUploadPlan],
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

        if let verdict = response.verdict {
          handleVerdict(verdict)
          return false
        }

        throw VerifyWebSocketError.unexpectedServerResponse(
          describeUnexpectedServerMessage(
            response,
            fallback: String(
              localized: "Unexpected NFC completion response from the server."
            )
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
    plans: [NFCUploadPlan],
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

  private func queuePhaseUpdate(_ phase: AttemptPhase, error: String?) {
    let previousTask = pendingPhaseUpdateTask
    pendingPhaseUpdateTask = Task { @MainActor [weak self] in
      await previousTask?.value

      guard let self, let webSocketService = self.webSocketService else {
        return
      }

      do {
        try await webSocketService.sendPhase(phase, error: error)
      } catch {
#if DEBUG
        print("Failed to update phase \(phase.rawValue): \(error.localizedDescription)")
#endif
      }
    }
  }

  private func waitForPendingPhaseUpdates() async {
    let task = pendingPhaseUpdateTask
    await task?.value
  }

  /// Serialises liveness uploads via a continuation queue. Throws
  /// `CancellationError` if the session is torn down while parked.
  private func waitForLivenessUploadTurn() async throws {
    if !livenessUploadInFlight {
      livenessUploadInFlight = true
      return
    }
    try await withCheckedThrowingContinuation { continuation in
      livenessUploadWaiters.append(continuation)
    }
    // Slot ownership transferred from the previous owner.
  }

  /// Hand off the slot to the next waiter, or mark idle.
  private func releaseLivenessUploadSlot() {
    if livenessUploadWaiters.isEmpty {
      livenessUploadInFlight = false
      return
    }
    let next = livenessUploadWaiters.removeFirst()
    next.resume()
  }

  /// Free the slot and unwind parked waiters with cancellation.
  private func cancelLivenessUploadWaiters() {
    let waiters = livenessUploadWaiters
    livenessUploadWaiters = []
    livenessUploadInFlight = false
    for waiter in waiters {
      waiter.resume(throwing: CancellationError())
    }
  }

  private func resolveDisplayError(_ error: Error) -> Error {
    guard let socketError = error as? VerifyWebSocketError else {
      return error
    }

    if isVerificationSessionConnectionLoss(socketError) {
      return VerificationError.verificationInterrupted
    }

    return socketError
  }

  private func beginNFCUpload(totalChunkCount: Int) {
    isUploadingNFC = true
    nfcUploadProgress = totalChunkCount > 0 ? 0 : 1
    nfcUploadStatusMessage = String(localized: "Preparing secure upload…")
  }

  private func resetNFCUploadState() {
    isUploadingNFC = false
    nfcUploadProgress = 0
    nfcUploadStatusMessage = nil
  }

}

enum VerificationError: LocalizedError {
  case notInitialized
  case encryptionFailed
  case uploadFailed
  case verificationInterrupted
  case missingRequiredNFCData(String, documentChipName: String)

  var errorDescription: String? {
    switch self {
    case .notInitialized:
      return String(localized: "Session not initialized. Please scan a QR code.")
    case .encryptionFailed:
      return String(localized: "Failed to encrypt data.")
    case .uploadFailed:
      return String(localized: "Failed to upload data. Please try again.")
    case .verificationInterrupted:
      return String(
        localized:
          "Connection to the verification session was lost. Start again from the beginning."
      )
    case .missingRequiredNFCData(let dataGroup, let documentChipName):
      return String(
        localized:
          "Missing \(dataGroup) from NFC read. Please scan your \(documentChipName) again."
      )
    }
  }
}

enum LivenessError: LocalizedError, Equatable {
  case captureFailed
  case videoReadFailed
  case videoEmpty
  case uploadFailed

  var errorDescription: String? {
    switch self {
    case .captureFailed:
      return String(localized: "Liveness recording failed. Please try again.")
    case .videoReadFailed:
      return String(
        localized: "Could not read the recorded video. Please try again."
      )
    case .videoEmpty:
      return String(
        localized: "The recorded liveness video was empty. Please try again."
      )
    case .uploadFailed:
      return String(
        localized: "Failed to upload the liveness recording. Please try again."
      )
    }
  }
}
