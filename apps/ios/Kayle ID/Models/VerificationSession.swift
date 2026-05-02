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

/// The current step in the verification flow.
enum VerificationStep: Int, CaseIterable {
  case welcome        // Landing screen
  case scanning       // Scanning QR code
  case mrz            // Scanning passport MRZ
  case rfidCheck      // Asking if document has RFID (required, no skip)
  case rfidUnsupported // Document does not support RFID/NFC
  case nfc            // Reading NFC chip
  case selfieIntro    // Preparing the user for selfie capture
  case selfie         // Taking selfie
  case shareDetails   // Review requested fields
  case complete       // Verification complete
  case error          // Error state

  var title: String {
    switch self {
    case .welcome: return "Welcome"
    case .scanning: return "Scan QR Code"
    case .mrz: return "Scan Document"
    case .rfidCheck: return "RFID Check"
    case .rfidUnsupported: return "Unsupported Document"
    case .nfc: return "Read Chip"
    case .selfieIntro: return "Selfie Instructions"
    case .selfie: return "Take Selfie"
    case .shareDetails: return "Review Details"
    case .complete: return "Complete"
    case .error: return "Error"
    }
  }
}

/// Attempt phase values matching the API.
/// These correspond to `AttemptPhase` in `packages/config/src/e2ee-types.ts`.
enum AttemptPhase: String, Codable {
  case initialized = "initialized"
  case mobileConnected = "mobile_connected"
  case mrzScanning = "mrz_scanning"
  case mrzComplete = "mrz_complete"
  case nfcReading = "nfc_reading"
  case nfcComplete = "nfc_complete"
  case selfieCapturing = "selfie_capturing"
  case selfieComplete = "selfie_complete"
  case uploading = "uploading"
  case complete = "complete"
  case error = "error"
}

/// Observable session state for the verification flow.
@MainActor
final class VerificationSession: ObservableObject {
  @Published var step: VerificationStep = .welcome
  @Published var payload: QRCodePayload?
  @Published var errorMessage: String?
  @Published var isRetryingVerification = false
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
  @Published var nfcResult: PassportReadResult?
  @Published var selfieImages: [UIImage] = []
  @Published var hasRFIDSymbol: Bool?

  // Services
  private var webSocketService: VerifyWebSocketService?
  private var selfieUploadsExpected = 0
  private var selfieSentIndices = Set<Int>()
  private var selfiePayloadsByIndex: [Int: Data] = [:]
  private var selfieUploadCancelled = false
  private var selfieUploadInFlight = false
  private var pendingPhaseUpdateTask: Task<Void, Never>?
  private let nfcChunkSize = 64 * 1024
  private let selfieChunkSize = 128 * 1024
  private let selfieCompressionQuality: CGFloat = 0.72
  private let requiredSelfieTotal = 3

  private struct NFCUploadPlan {
    let kind: VerifyDataKind
    let chunks: [Data]
  }

  private struct SelfieUploadPlan {
    let index: Int
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
    nfcUploadStatusMessage = "Reconnecting to continue secure upload…"
    try await webSocketService.reconnectForTransfer()
    nfcUploadStatusMessage = "Preparing secure upload…"

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

      nfcUploadStatusMessage = "Waiting for secure verification…"
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
  
  /// Send a single selfie image immediately after capture.
  func sendSelfieImage(_ image: UIImage, index: Int, total: Int) async throws -> Bool {
    try await waitForSelfieUploadTurn()
    defer {
      selfieUploadInFlight = false
    }

    guard let webSocketService else {
      throw VerificationError.notInitialized
    }

    await waitForPendingPhaseUpdates()

    if selfieUploadCancelled {
      throw SelfieError.uploadFailed
    }

    if total != requiredSelfieTotal {
      throw SelfieError.uploadFailed
    }

    if index < 0 || index >= requiredSelfieTotal {
      throw SelfieError.uploadFailed
    }

    if selfieUploadsExpected == 0 {
      selfieUploadsExpected = total
    }

    guard let jpeg = image.jpegData(compressionQuality: selfieCompressionQuality) else {
      throw SelfieError.compressionFailed
    }

    selfiePayloadsByIndex[index] = jpeg

    let plans = try buildKnownSelfieUploadPlans()
    try await uploadKnownSelfiePlans(plans, via: webSocketService)

    let hasAllSelfies = selfiePayloadsByIndex.count == requiredSelfieTotal
    guard hasAllSelfies else {
      return false
    }

    try await completeSelfiePhase(plans: plans, via: webSocketService)
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
        print("Failed to finalize MRZ scan: \(error.localizedDescription)")
      }
    }
  }

  /// Handle an error during verification.
  func handleError(_ error: Error, forAttemptId attemptId: String? = nil) {
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

    let resolvedError = resolveDisplayError(error)
    let terminalAttemptId = attemptId ?? payload?.attemptId
    verdict = nil
    errorMessage = resolvedError.localizedDescription
    isRetryingVerification = false
    step = .error
    selfieUploadCancelled = true

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
    errorMessage = "Retry could not start. \(resolvedError.localizedDescription)"
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
    selfieImages = []
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
    let baseURL = APIService.baseURL(from: payload.sessionId)
    let attemptId = payload.attemptId

    let service = VerifyWebSocketService(
      sessionId: payload.sessionId,
      attemptId: payload.attemptId,
      mobileWriteToken: payload.mobileWriteToken,
      baseURL: baseURL,
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
      }
    )

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

  private func resetAttemptState(clearPayload: Bool) {
    if clearPayload {
      payload = nil
    }

    verdict = nil
    errorMessage = nil
    isRetryingVerification = false
    shareRequest = nil
    selectedShareFieldKeys = []
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    mrzResult = nil
    nfcResult = nil
    selfieImages = []
    hasRFIDSymbol = nil
    webSocketService = nil
    selfieUploadsExpected = 0
    selfieSentIndices.removeAll()
    selfiePayloadsByIndex.removeAll()
    selfieUploadCancelled = false
    selfieUploadInFlight = false
    resetNFCUploadState()
    pendingPhaseUpdateTask?.cancel()
    pendingPhaseUpdateTask = nil
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
    resetNFCUploadState()
    activeWebSocketService?.disconnect()
  }

  private func handleVerdict(_ verdict: VerifyServerVerdict) {
    self.verdict = verdict
    errorMessage = nil
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    selfieUploadCancelled = isRejectedVerdict(verdict)

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
      shareSelectionErrorMessage =
        "Choose at least one verification detail before continuing."
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
          fallback: "Unexpected share selection response from the server."
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

  private func buildKnownSelfieUploadPlans() throws -> [SelfieUploadPlan] {
    let sortedIndexes = selfiePayloadsByIndex.keys.sorted()

    guard !sortedIndexes.isEmpty else {
      throw VerificationError.uploadFailed
    }

    let plans = sortedIndexes.compactMap { index -> SelfieUploadPlan? in
      guard let payload = selfiePayloadsByIndex[index] else {
        return nil
      }
      return SelfieUploadPlan(
        index: index,
        chunks: chunkData(payload, chunkSize: selfieChunkSize)
      )
    }

    guard !plans.isEmpty else {
      throw VerificationError.uploadFailed
    }

    return plans
  }

  private func uploadKnownSelfiePlans(
    _ plans: [SelfieUploadPlan],
    via webSocketService: VerifyWebSocketService
  ) async throws {
    for plan in plans {
      if selfieSentIndices.contains(plan.index) {
        continue
      }
      try await uploadSelfiePlan(plan, via: webSocketService)
    }
  }

  private func uploadSelfiePlan(
    _ plan: SelfieUploadPlan,
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
      if selfieUploadCancelled {
        throw SelfieError.uploadFailed
      }

      do {
        let response = try await webSocketService.sendDataAwaitResponse(
          kind: .selfie,
          raw: plan.chunks[nextChunkIndex],
          index: plan.index,
          total: requiredSelfieTotal,
          chunkIndex: nextChunkIndex,
          chunkTotal: chunkTotal
        )

        guard
          isExpectedDataAck(
            ackMessage: response.ackMessage,
            kind: VerifyDataKind.selfie.rawValue,
            index: plan.index,
            chunkIndex: nextChunkIndex,
            chunkTotal: chunkTotal
          )
        else {
          throw VerifyWebSocketError.unexpectedServerResponse(
            describeUnexpectedServerMessage(
              response,
              fallback: "Unexpected selfie upload response from the server."
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
          retryInstruction.kind == VerifyDataKind.selfie.rawValue,
          retryInstruction.index == plan.index,
          retryInstruction.chunkIndex >= 0,
          retryInstruction.chunkIndex < chunkTotal
        else {
          throw socketError
        }

        nextChunkIndex = retryInstruction.chunkIndex
      }
    }

    selfieSentIndices.insert(plan.index)
  }

  private func completeSelfiePhase(
    plans: [SelfieUploadPlan],
    via webSocketService: VerifyWebSocketService
  ) async throws {
    while true {
      do {
        let response = try await webSocketService.sendPhaseAwaitResponse(
          .selfieComplete,
          error: nil
        )

        if let verdict = response.verdict {
          handleVerdict(verdict)
          return
        }

        throw VerifyWebSocketError.unexpectedServerResponse(
          describeUnexpectedServerMessage(
            response,
            fallback: "Unexpected selfie completion response from the server."
          )
        )
      } catch let socketError as VerifyWebSocketError {
        guard case .serverError(let code, let message) = socketError else {
          throw socketError
        }

        guard
          let missingInstruction = parseMissingSelfieDataInstruction(
            errorCode: code,
            errorMessage: message
          )
        else {
          throw socketError
        }

        try await resendMissingSelfieData(
          missingInstruction,
          plans: plans,
          via: webSocketService
        )
      }
    }
  }

  private func resendMissingSelfieData(
    _ missingInstruction: VerifyMissingSelfieDataInstruction,
    plans: [SelfieUploadPlan],
    via webSocketService: VerifyWebSocketService
  ) async throws {
    let plansByIndex = Dictionary(uniqueKeysWithValues: plans.map { ($0.index, $0) })

    for missingIndex in missingInstruction.missingSelfieIndexes.sorted() {
      guard let plan = plansByIndex[missingIndex] else {
        continue
      }
      try await uploadSelfiePlan(plan, via: webSocketService)
    }

    for missingChunk in missingInstruction.missingChunks {
      guard
        missingChunk.kind == VerifyDataKind.selfie.rawValue,
        let plan = plansByIndex[missingChunk.index]
      else {
        continue
      }

      for chunkIndex in missingChunk.missingChunkIndices.sorted() {
        guard chunkIndex >= 0, chunkIndex < plan.chunks.count else {
          continue
        }

        try await uploadSelfiePlan(
          plan,
          via: webSocketService,
          startingAt: chunkIndex
        )
      }
    }
  }

  private func buildNFCUploadPlans(from result: PassportReadResult) throws -> [NFCUploadPlan] {
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

    return [
      NFCUploadPlan(kind: .dg1, chunks: chunkData(dg1.data, chunkSize: nfcChunkSize)),
      NFCUploadPlan(kind: .dg2, chunks: chunkData(dg2.data, chunkSize: nfcChunkSize)),
      NFCUploadPlan(kind: .sod, chunks: chunkData(sod.data, chunkSize: nfcChunkSize)),
    ]
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
              fallback: "Unexpected NFC upload response from the server."
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
    while true {
      do {
        let response = try await webSocketService.sendPhaseAwaitResponse(
          .nfcComplete,
          error: nil
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
            fallback: "Unexpected NFC completion response from the server."
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
        print("Failed to update phase \(phase.rawValue): \(error.localizedDescription)")
      }
    }
  }

  private func waitForPendingPhaseUpdates() async {
    let task = pendingPhaseUpdateTask
    await task?.value
  }

  private func waitForSelfieUploadTurn() async throws {
    while selfieUploadInFlight {
      try await Task.sleep(nanoseconds: 50_000_000)
    }

    selfieUploadInFlight = true
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
    nfcUploadStatusMessage = "Preparing secure upload…"
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
      return "Session not initialized. Please scan a QR code."
    case .encryptionFailed:
      return "Failed to encrypt data."
    case .uploadFailed:
      return "Failed to upload data. Please try again."
    case .verificationInterrupted:
      return "Connection to the verification session was lost. Start again from the beginning."
    case .missingRequiredNFCData(let dataGroup, let documentChipName):
      return "Missing \(dataGroup) from NFC read. Please scan your \(documentChipName) again."
    }
  }
}
