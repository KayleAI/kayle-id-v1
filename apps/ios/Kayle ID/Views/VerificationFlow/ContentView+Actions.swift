import OSLog
import SwiftUI
import UIKit

extension ContentView {
  var scanningBackAction: (() -> Void)? {
    if session.payload == nil {
      return goBackFromScanning
    }

    return nil
  }

  var nfcBackAction: (() -> Void)? {
    if isDisplayingNFCUploadUI {
      return nil
    }

    return goBackFromNFC
  }

  @ViewBuilder
  func cameraDrawer(for drawer: CameraCaptureDrawer) -> some View {
    switch drawer {
    case .qr:
      CameraPermissionGate(onCancel: {
        activeCameraDrawer = nil
      }) {
        qrScannerDrawer
      }
    case .mrz:
      CameraPermissionGate(onCancel: {
        activeCameraDrawer = nil
      }) {
        mrzScannerDrawer
      }
    case .liveness:
      CameraPermissionGate(onCancel: {
        activeCameraDrawer = nil
      }) {
        livenessCaptureDrawer
      }
    }
  }

  var qrScannerDrawer: some View {
    QRScannerView(
      onScan: handleQRCode,
      isConnecting: isResolvingQRCode,
      connectingMessage: String(localized: "Connecting securely...")
    )
  }

  var mrzScannerDrawer: some View {
    ZStack {
      MRZScannerView(onValidMRZ: { _, result, can in
        guard !didTriggerMRZ else { return }
        didTriggerMRZ = true

        session.mrzResult = result
        cardAccessNumber = can

        withAnimation(.easeInOut(duration: 0.25)) {
          isMRZLocked = true
        }
        withAnimation(.easeInOut(duration: 1.0)) {
          cameraBlur = 8
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          withAnimation(.easeInOut(duration: 0.25)) {
            activeCameraDrawer = nil
          }

          DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            session.moveToStep(.rfidCheck)
            session.syncCompletedMRZScan()
          }
        }
      })
      .ignoresSafeArea()
      .blur(radius: cameraBlur)

      ScannerOverlayView(
        cutout: .topSafeAreaRectangle(
          horizontalInset: 16,
          topInset: 16,
          aspectRatio: 0.75,
          cornerRadius: 12
        ),
        title: String(localized: "Scan your document"),
        subtitle: String(localized: "Align the printed code within the box."),
        borderColor: isMRZLocked ? .green : .white,
        borderWidth: 6,
        overlayOpacity: 0.55,
        instructionBottomPadding: CameraDrawerMetrics.instructionBottomPadding
      )
      .allowsHitTesting(false)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  var livenessCaptureDrawer: some View {
    LivenessCaptureView(
      onComplete: {
        activeCameraDrawer = nil
      },
      onRejected: {
        activeCameraDrawer = nil
      },
      onError: { error in
        let sessionId = session.payload?.sessionId
        activeCameraDrawer = nil
        session.handleError(error, forSessionId: sessionId)
      }
    )
    .environmentObject(session)
    .id(session.livenessCaptureGeneration)
  }

  func handleCompletionPrimaryAction() {
    if let checkResult = session.checkResult,
      isNotConfirmedCheck(checkResult),
      checkResult.retryAllowed
    {
      captureCurrentStepSnapshot()
      let sessionId = session.payload?.sessionId
      Task {
        do {
          switch checkResult.failedCheck {
          case .mrz:
            try await session.retryMRZ()
          case .nfc:
            try await session.retryNFC()
          case .liveness:
            try await session.retryLiveness()
          case .none:
            try await session.retryMRZ()
          }
        } catch {
          session.handleRetryError(error, forSessionId: sessionId)
        }
      }
      return
    }

    resetVerificationFlow()
  }

  func handleQRCode(_ code: String) {
    guard !isResolvingQRCode else {
      return
    }

    let resolutionID = UUID()
    let startedAt = Date()
    activeQRCodeResolutionID = resolutionID
    isResolvingQRCode = true
    startQRCodeResolutionTimeout(for: resolutionID)

    Task { @MainActor in
      defer {
        clearQRCodeResolutionState(for: resolutionID)
      }

      do {
        let payload = try QRCodePayload.parse(from: code)
        try await session.initialize(with: payload)
        guard activeQRCodeResolutionID == resolutionID else {
          return
        }
        let durationMs = Int(Date().timeIntervalSince(startedAt) * 1000)
        performanceLogger.info("qr_scan_to_hello_ack duration_ms=\(durationMs)")
        clearQRCodeResolutionState(for: resolutionID)
        activeCameraDrawer = nil
        session.moveToStep(.mrz)
      } catch {
        guard activeQRCodeResolutionID == resolutionID else {
          return
        }
        session.handleError(error)
      }
    }
  }

  func startQRCodeResolutionTimeout(for resolutionID: UUID) {
    qrResolutionTimeoutTask?.cancel()
    qrResolutionTimeoutTask = Task { @MainActor in
      do {
        try await Task.sleep(nanoseconds: qrInitializationTimeoutNs)
      } catch {
        return
      }

      guard activeQRCodeResolutionID == resolutionID, isResolvingQRCode else {
        return
      }

      activeQRCodeResolutionID = nil
      qrResolutionTimeoutTask = nil
      isResolvingQRCode = false
      session.cancelInitializationAttempt()
      session.handleError(VerifyWebSocketError.helloTimedOut)
    }
  }

  func clearQRCodeResolutionState(for resolutionID: UUID) {
    guard activeQRCodeResolutionID == resolutionID else {
      return
    }

    clearQRCodeResolutionState()
  }

  func clearQRCodeResolutionState() {
    activeQRCodeResolutionID = nil
    qrResolutionTimeoutTask?.cancel()
    qrResolutionTimeoutTask = nil
    isResolvingQRCode = false
  }

  func startQRScanning() {
    session.moveToStep(.scanning)
    presentQRDrawer()
  }

  func goBackFromScanning() {
    session.moveToStep(.welcome)
  }

  func goBackFromMRZ() {
    session.moveToStep(.scanning)
  }

  func presentCancelVerificationConfirmation() {
    isCancelVerificationConfirmationPresented = true
  }

  func dismissCancelVerificationConfirmation() {
    isCancelVerificationConfirmationPresented = false
  }

  func confirmCancelVerification() {
    dismissCancelVerificationConfirmation()
    cancelVerificationFlow()
  }

  func goBackFromRFIDCheck() {
    session.hasRFIDSymbol = nil
    session.moveToStep(.mrz)
  }

  func goBackFromRFIDUnsupported() {
    session.hasRFIDSymbol = nil
    session.moveToStep(.rfidCheck)
  }

  func goBackFromNFC() {
    hasStartedNFCScan = false
    clearRetainedNFCUploadUI()
    resetNFCReaderState()
    session.nfcResult = nil
    session.hasRFIDSymbol = nil
    session.moveToStep(.rfidCheck)
  }

  func presentQRDrawer() {
    AppAttestService.shared.prewarm(baseURL: APIService.baseURL(from: ""))
    activeCameraDrawer = .qr
  }

  func presentMRZDrawer() {
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
    activeCameraDrawer = .mrz
    Task {
      await session.updatePhase(.mrzScanning)
    }
  }

  func handleCameraDrawerDismiss() {
    if isResolvingQRCode {
      session.cancelInitializationAttempt()
      clearQRCodeResolutionState()
    }
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
  }

  func startLivenessCapture() {
    session.moveToStep(.liveness)
    presentLivenessDrawer()
    Task {
      await session.updatePhase(.livenessCapturing)
    }
  }

  func presentLivenessDrawer() {
    activeCameraDrawer = .liveness
  }

  func startNFCScan() {
    clearRetainedNFCUploadUI()
    hasStartedNFCScan = true
    nfcReader.start(
      mrzKey: session.mrzResult?.mrzKey ?? "",
      cardAccessNumber: cardAccessNumber,
      activeAuthChallenge: session.activeAuthChallenge
    )
  }

  func retryNFCUpload() {
    guard let nfcResult = session.nfcResult ?? nfcReader.result else {
      return
    }

    uploadNFCResult(nfcResult)
  }

  func uploadNFCResult(_ result: DocumentReadResult) {
    session.nfcResult = result
    clearRetainedNFCUploadUI()
    let sessionId = session.payload?.sessionId

    Task {
      do {
        let shouldContinue = try await session.uploadNFCData()
        if shouldContinue {
          session.moveToStep(.livenessIntro)
        }
      } catch {
        clearRetainedNFCUploadUI()
        if
          let socketError = error as? VerifyWebSocketError,
          isVerificationSessionConnectionLoss(socketError)
        {
          return
        }
        session.handleError(error, forSessionId: sessionId)
      }
    }
  }

  func captureCurrentStepSnapshot() {
    outgoingStepSnapshot = makeStepRenderSnapshot(for: session.step)
  }

  func tryAnotherDocument() {
    clearDocumentCaptureUIState()
    session.clearDocumentCaptureState()
    session.moveToStep(.mrz)
  }

  func resetVerificationFlow() {
    captureCurrentStepSnapshot()
    clearDocumentCaptureUIState()
    session.reset()
  }

  func cancelVerificationFlow() {
    captureCurrentStepSnapshot()
    let sessionId = session.payload?.sessionId

    Task {
      do {
        try await session.cancelVerification()
        clearDocumentCaptureUIState()
        session.reset()
      } catch {
        session.handleError(error, forSessionId: sessionId)
      }
    }
  }

  func resetNFCReaderState() {
    nfcReader.stop()
  }

  func clearDocumentCaptureUIState() {
    activeCameraDrawer = nil
    session.cancelInitializationAttempt()
    clearQRCodeResolutionState()
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
    cardAccessNumber = nil
    hasStartedNFCScan = false
    clearRetainedNFCUploadUI()
    resetNFCReaderState()
  }

  var isDisplayingNFCUploadUI: Bool {
    session.isUploadingNFC || isRetainingNFCUploadUI
  }

  var shouldKeepDeviceAwake: Bool {
    shouldPreventDeviceSleepDuringVerification(
      hasActiveSession: session.payload != nil,
      isTerminalStep: session.step == .complete || session.step == .error
    )
  }

  var displayedNFCUploadProgress: Double {
    if session.isUploadingNFC {
      return session.nfcUploadProgress
    }

    if isRetainingNFCUploadUI {
      return retainedNFCUploadProgress
    }

    return session.nfcUploadProgress
  }

  func clearRetainedNFCUploadUI() {
    isRetainingNFCUploadUI = false
    retainedNFCUploadProgress = 0
  }

  func syncIdleTimerState() {
    setIdleTimerDisabled(shouldKeepDeviceAwake)
  }

  func setIdleTimerDisabled(_ disabled: Bool) {
    UIApplication.shared.isIdleTimerDisabled = disabled
  }

  func drawerMatchesStep(_ drawer: CameraCaptureDrawer, step: VerificationStep) -> Bool {
    switch drawer {
    case .qr:
      return step == .scanning
    case .mrz:
      return step == .mrz
    case .liveness:
      return step == .liveness
    }
  }
}
