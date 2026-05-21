import Combine
import Foundation
import OSLog
import SwiftUI

@MainActor
final class VerificationSession: ObservableObject {
  let performanceLogger = Logger(
    subsystem: "id.kayle.ios",
    category: "VerificationPerformance"
  )

  @Published var step: VerificationStep = .welcome
  @Published var payload: QRCodePayload?
  @Published var errorMessage: String?
  @Published var isRetryingVerification = false
  @Published var isReconnecting = false
  @Published var livenessCaptureGeneration = UUID()
  @Published var checkResult: VerifyServerCheckResult?
  @Published var remainingNfcRetries: Int = 3
  @Published var remainingLivenessRetries: Int = 3
  @Published var failedCheck: VerifyCheckKind = .none
  @Published var shareRequest: VerifyShareRequest?
  @Published var selectedShareFieldKeys = Set<String>()
  @Published var shareSelectionErrorMessage: String?
  @Published var isSubmittingShareSelection = false
  @Published var isUploadingNFC = false
  @Published var nfcUploadStatusMessage: String?
  @Published var nfcUploadProgress: Double = 0

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

  var webSocketService: VerifyWebSocketService?
  var initializingWebSocketService: VerifyWebSocketService?
  var initializationCancellationToken = UUID()
  var livenessUploadStarted = false
  var livenessUploadComplete = false
  var livenessVideoBytes: Data?
  var livenessUploadCancelled = false
  var livenessUploadInFlight = false
  var livenessUploadWaiters: [CheckedContinuation<Void, Error>] = []
  var pendingPhaseUpdateTask: Task<Void, Never>?
  var reconnectTask: Task<Void, Never>?
  let nfcChunkSize = 224 * 1024
  let livenessChunkSize = 224 * 1024
  let uploadWindowSize = 3
  let maxReconnectAttempts = 5
  let reconnectBaseDelayNs: UInt64 = 1_000_000_000

  var privacyRequestURL: URL? {
    guard let payload else {
      return nil
    }

    return APIService.privacyRequestURL(
      sessionId: payload.sessionId,
      cancelToken: payload.cancelToken
    )
  }

  func initialize(with payload: QRCodePayload) async throws {
    guard payload.isValid else {
      throw QRCodePayloadError.invalidPayload
    }

    let initializationToken = UUID()
    initializationCancellationToken = initializationToken
    teardownSessionState(clearPayload: true)
    try await bootstrapSession(
      with: payload,
      initializationToken: initializationToken
    )
  }

  func cancelInitializationAttempt() {
    initializationCancellationToken = UUID()
    let activeInitializingService = initializingWebSocketService
    initializingWebSocketService = nil
    activeInitializingService?.disconnect()
  }

  func updatePhase(_ phase: AttemptPhase, error: String? = nil) async {
    queuePhaseUpdate(phase, error: error)
  }
  
  func uploadMRZData() async throws {
    guard mrzResult != nil else {
      throw VerificationError.notInitialized
    }
  }
  
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

}
