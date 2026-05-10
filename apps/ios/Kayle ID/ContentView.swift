import SwiftUI
import UIKit

enum CameraCaptureDrawer: String, Identifiable {
  case qr
  case mrz
  case selfie

  var id: String {
    rawValue
  }
}

private struct NFCRenderSnapshot {
  let documentName: String
  let uploadProgress: Double
  let isUploading: Bool
  let hasStarted: Bool
  let errorMessage: String?
  let result: DocumentReadResult?
}

private struct DocumentCopySnapshot {
  let documentName: String
  let documentNameWithArticle: String
  let rfidSymbolLocationDescription: String
}

private struct ShareDetailsRenderSnapshot {
  let shareRequest: VerifyShareRequest?
  let selectedShareFieldKeys: Set<String>
  let shareSelectionErrorMessage: String?
  let isSubmittingShareSelection: Bool
  let nfcResult: DocumentReadResult?
  let mrzResult: MRZResult?
}

private struct CompletionRenderSnapshot {
  let isSuccess: Bool
  let message: String
  let primaryButtonTitle: String
  let secondaryButtonTitle: String?
}

private struct StepRenderSnapshot: Identifiable {
  let id = UUID()
  let step: VerificationStep
  var showsBackButton = false
  var showsCancelButton = false
  var documentCopy: DocumentCopySnapshot? = nil
  var nfc: NFCRenderSnapshot? = nil
  var shareDetails: ShareDetailsRenderSnapshot? = nil
  var completion: CompletionRenderSnapshot? = nil
}

@MainActor
private struct FrozenNFCReadingView: View {
  let snapshot: NFCRenderSnapshot
  var onBack: (() -> Void)? = nil

  var body: some View {
    NFCReadingView(
      nfcReader: snapshotReader,
      documentName: snapshot.documentName,
      uploadProgress: snapshot.uploadProgress,
      isUploading: snapshot.isUploading,
      hasStarted: snapshot.hasStarted,
      onBack: onBack,
      onStart: {},
      onComplete: { _ in }
    )
    .allowsHitTesting(false)
  }

  private var snapshotReader: DocumentNFCReader {
    let reader = DocumentNFCReader()
    reader.errorMessage = snapshot.errorMessage
    reader.result = snapshot.result
    return reader
  }
}

@MainActor
private struct FrozenShareDetailsView: View {
  let snapshot: ShareDetailsRenderSnapshot

  var body: some View {
    ShareDetailsView(session: snapshotSession, onSubmit: {}, onCancel: {})
      .allowsHitTesting(false)
  }

  private var snapshotSession: VerificationSession {
    let session = VerificationSession()
    session.shareRequest = snapshot.shareRequest
    session.selectedShareFieldKeys = snapshot.selectedShareFieldKeys
    session.shareSelectionErrorMessage = snapshot.shareSelectionErrorMessage
    session.isSubmittingShareSelection = snapshot.isSubmittingShareSelection
    session.nfcResult = snapshot.nfcResult
    session.mrzResult = snapshot.mrzResult
    return session
  }
}

struct ContentView: View {
  @Binding var pendingQRCode: String?

  private enum NavigationDirection {
    case forward
    case backward
  }

  @StateObject private var session: VerificationSession
  @StateObject private var nfcReader: DocumentNFCReader

  @State private var outgoingStepSnapshot: StepRenderSnapshot?
  @State private var lastStep: VerificationStep = .welcome
  @State private var navDirection: NavigationDirection = .forward
  @State private var transitionProgress: CGFloat = 1

  @State private var activeCameraDrawer: CameraCaptureDrawer?
  @State private var isMRZLocked = false
  @State private var cameraBlur: CGFloat = 0
  @State private var didTriggerMRZ = false
  @State private var cardAccessNumber: String?
  @State private var isAboutSheetPresented = false
  @State private var isResolvingQRCode = false
  @State private var isCancelVerificationConfirmationPresented = false
  @State private var hasStartedNFCScan = false
  @State private var isRetainingNFCUploadUI = false
  @State private var retainedNFCUploadProgress: Double = 0

  @MainActor
  init(
    pendingQRCode: Binding<String?>,
    session: VerificationSession? = nil,
    nfcReader: DocumentNFCReader? = nil,
    initialCameraDrawer: CameraCaptureDrawer? = nil,
    initialAboutSheetPresented: Bool = false
  ) {
    let resolvedSession = session ?? VerificationSession()
    let resolvedNFCReader = nfcReader ?? DocumentNFCReader()

    _pendingQRCode = pendingQRCode
    _session = StateObject(wrappedValue: resolvedSession)
    _nfcReader = StateObject(wrappedValue: resolvedNFCReader)
    _activeCameraDrawer = State(initialValue: initialCameraDrawer)
    _isAboutSheetPresented = State(initialValue: initialAboutSheetPresented)
  }

  var body: some View {
    NavigationStack {
      ZStack {
        Color(.systemBackground).ignoresSafeArea()

        GeometryReader { geometry in
          let width = geometry.size.width
          let directionSign: CGFloat = navDirection == .forward ? 1 : -1

          ZStack {
            if let outgoingStepSnapshot {
              stepView(for: outgoingStepSnapshot)
                .frame(width: width, height: geometry.size.height)
                .offset(x: -directionSign * width * transitionProgress)
                .allowsHitTesting(false)
            }

            stepView(for: session.step)
              .frame(width: width, height: geometry.size.height)
              .offset(x: directionSign * width * (1 - transitionProgress))
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .clipped()
        }
      }
    }
    .tint(.primary)
    .onAppear {
      lastStep = session.step
      syncIdleTimerState()
    }
    .onDisappear {
      setIdleTimerDisabled(false)
    }
    .onChange(of: shouldKeepDeviceAwake) { _ in
      syncIdleTimerState()
    }
    .onChange(of: session.isUploadingNFC) { isUploading in
      if isUploading {
        isRetainingNFCUploadUI = true
        retainedNFCUploadProgress = session.nfcUploadProgress
      }
    }
    .onChange(of: session.nfcUploadProgress) { progress in
      if session.step == .nfc, session.isUploadingNFC {
        retainedNFCUploadProgress = progress
      }
    }
    .onChange(of: session.step) { newStep in
      guard newStep != lastStep else { return }

      let outgoingStep = lastStep
      navDirection = newStep.rawValue >= lastStep.rawValue ? .forward : .backward

      if outgoingStepSnapshot?.step != outgoingStep {
        outgoingStepSnapshot = makeStepRenderSnapshot(for: outgoingStep)
      }

      lastStep = newStep
      transitionProgress = 0

      if let activeCameraDrawer, !drawerMatchesStep(activeCameraDrawer, step: newStep) {
        self.activeCameraDrawer = nil
      }

      if outgoingStep == .nfc, newStep != .nfc {
        clearRetainedNFCUploadUI()
      }

      withAnimation(.easeInOut(duration: 0.35)) {
        transitionProgress = 1
      }

      let snapshotID = outgoingStepSnapshot?.id
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
        if outgoingStepSnapshot?.id == snapshotID {
          outgoingStepSnapshot = nil
        }
      }
    }
    .sheet(item: $activeCameraDrawer, onDismiss: handleCameraDrawerDismiss) { drawer in
      cameraDrawer(for: drawer)
      .presentationDetents([.large])
      .presentationDragIndicator(.visible)
    }
    .sheet(isPresented: $isAboutSheetPresented) {
      AboutSheetView()
    }
    .background {
      Color.clear
        .confirmationDialog(
          "Cancel?",
          isPresented: $isCancelVerificationConfirmationPresented,
          titleVisibility: .visible
        ) {
          Button("Cancel", role: .destructive) {
            confirmCancelVerification()
          }
          Button("Stay here", role: .cancel) {
            dismissCancelVerificationConfirmation()
          }
        } message: {
          Text("This will stop the current verification on this device.")
        }
        .tint(.primary)
    }
    .onChange(of: pendingQRCode) { newCode in
      guard let code = newCode, !code.isEmpty else {
        return
      }

      handleQRCode(code)
      pendingQRCode = nil
    }
  }

  private func stepView(for step: VerificationStep) -> AnyView {
    switch step {
    case .welcome:
      return AnyView(
        WelcomeView(
        onGetStarted: {
          startQRScanning()
        },
        onAbout: {
          isAboutSheetPresented = true
        }
      )
      )
    case .scanning:
      return AnyView(scanningView)
    case .mrz:
      let mrzBackAction: (() -> Void)? = if session.payload == nil {
        goBackFromMRZ
      } else {
        nil
      }
      let mrzCancelAction: (() -> Void)? = if session.payload == nil {
        nil
      } else {
        presentCancelVerificationConfirmation
      }

      return AnyView(
        MRZIntroView(
          onContinue: presentMRZDrawer,
          onBack: mrzBackAction,
          onCancel: mrzCancelAction
        )
      )
    case .rfidCheck:
      return AnyView(
        RFIDCheckView(
        rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription,
        onHasRFID: {
          resetNFCReaderState()
          session.hasRFIDSymbol = true
          hasStartedNFCScan = false
          session.moveToStep(.nfc)
          Task {
            await session.updatePhase(.nfcReading)
          }
        },
        onNoRFID: {
          session.hasRFIDSymbol = false
          session.moveToStep(.rfidUnsupported)
        },
        onBack: goBackFromRFIDCheck
      )
      )
    case .rfidUnsupported:
      return AnyView(
        RFIDUnsupportedView(
        documentName: currentDocumentName,
        documentNameWithArticle: currentDocumentNameWithArticle,
        rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription,
        onTryAnotherDocument: tryAnotherDocument,
        onReturnHome: presentCancelVerificationConfirmation,
        onBack: goBackFromRFIDUnsupported
      )
      )
    case .nfc:
      return AnyView(
        NFCReadingView(
        nfcReader: nfcReader,
        documentName: currentDocumentName,
        uploadProgress: displayedNFCUploadProgress,
        isUploading: isDisplayingNFCUploadUI,
        hasStarted: hasStartedNFCScan,
        onBack: nfcBackAction,
        onStart: startNFCScan,
        onComplete: { result in
          session.nfcResult = result
          let attemptId = session.payload?.attemptId

          Task {
            do {
              let shouldContinue = try await session.uploadNFCData()
              if shouldContinue {
                session.moveToStep(.selfieIntro)
              }
            } catch {
              session.handleError(error, forAttemptId: attemptId)
            }
          }
        }
      )
      )
    case .selfieIntro:
      return AnyView(SelfieIntroView(onContinue: startSelfieCapture))
    case .selfie:
      return AnyView(SelfieIntroView(onContinue: presentSelfieDrawer))
    case .shareDetails:
      return AnyView(
        ShareDetailsView(
        session: session,
        onSubmit: {
          Task {
            await session.submitShareSelection()
          }
        },
        onCancel: presentCancelVerificationConfirmation
      )
      )
    case .complete:
      let secondaryButtonTitle = completionSecondaryButtonTitle
      let secondaryAction: (() -> Void)?

      if secondaryButtonTitle == nil {
        secondaryAction = nil
      } else if let verdict = session.verdict, isRejectedVerdict(verdict), verdict.retryAllowed {
        secondaryAction = presentCancelVerificationConfirmation
      } else {
        secondaryAction = { resetVerificationFlow() }
      }

      return AnyView(
        CompletionView(
        isSuccess: isAcceptedVerdict(session.verdict),
        message: completionMessage,
        isPrimaryLoading:
          isRejectedVerdict(session.verdict) &&
          session.verdict?.retryAllowed == true &&
          session.isRetryingVerification,
        isSecondaryDisabled: session.isRetryingVerification,
        primaryButtonTitle: completionPrimaryButtonTitle,
        onPrimaryAction: handleCompletionPrimaryAction,
        secondaryButtonTitle: secondaryButtonTitle,
        onSecondaryAction: secondaryAction
      )
      )
    case .error:
      return AnyView(
        CompletionView(
        isSuccess: false,
        message: session.errorMessage ?? "An unexpected error occurred.",
        primaryButtonTitle: "Start Again",
        onPrimaryAction: resetVerificationFlow,
        secondaryButtonTitle: nil,
        onSecondaryAction: nil
      )
      )
    }
  }

  private func stepView(for snapshot: StepRenderSnapshot) -> AnyView {
    switch snapshot.step {
    case .welcome:
      return AnyView(WelcomeView(onGetStarted: {}, onAbout: {}))
    case .scanning:
      return AnyView(
        QRIntroView(
          onContinue: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .mrz:
      return AnyView(
        MRZIntroView(
          onContinue: {},
          onBack: snapshot.showsBackButton ? {} : nil,
          onCancel: snapshot.showsCancelButton ? {} : nil
        )
      )
    case .rfidCheck:
      return AnyView(
        RFIDCheckView(
          rfidSymbolLocationDescription:
            snapshot.documentCopy?.rfidSymbolLocationDescription ??
            defaultRFIDSymbolLocationDescription,
          onHasRFID: {},
          onNoRFID: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .rfidUnsupported:
      return AnyView(
        RFIDUnsupportedView(
          documentName: snapshot.documentCopy?.documentName ?? defaultDocumentName,
          documentNameWithArticle:
            snapshot.documentCopy?.documentNameWithArticle ??
            defaultDocumentNameWithArticle,
          rfidSymbolLocationDescription:
            snapshot.documentCopy?.rfidSymbolLocationDescription ??
            defaultRFIDSymbolLocationDescription,
          onTryAnotherDocument: {},
          onReturnHome: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .nfc:
      if let nfcSnapshot = snapshot.nfc {
        return AnyView(
          FrozenNFCReadingView(
            snapshot: nfcSnapshot,
            onBack: snapshot.showsBackButton ? {} : nil
          )
        )
      } else {
        return AnyView(Color.clear)
      }
    case .selfieIntro, .selfie:
      return AnyView(SelfieIntroView(onContinue: {}))
    case .shareDetails:
      if let shareDetailsSnapshot = snapshot.shareDetails {
        return AnyView(FrozenShareDetailsView(snapshot: shareDetailsSnapshot))
      } else {
        return AnyView(Color.clear)
      }
    case .complete, .error:
      if let completionSnapshot = snapshot.completion {
        return AnyView(
          CompletionView(
          isSuccess: completionSnapshot.isSuccess,
          message: completionSnapshot.message,
          primaryButtonTitle: completionSnapshot.primaryButtonTitle,
          onPrimaryAction: {},
          secondaryButtonTitle: completionSnapshot.secondaryButtonTitle,
          onSecondaryAction: nil
        )
        )
      } else {
        return AnyView(Color.clear)
      }
    }
  }

  private var scanningView: some View {
    QRIntroView(
      onContinue: presentQRDrawer,
      onBack: scanningBackAction
    )
  }

  private var scanningBackAction: (() -> Void)? {
    if session.payload == nil {
      return { goBackFromScanning() }
    }

    return nil
  }

  private var nfcBackAction: (() -> Void)? {
    if isDisplayingNFCUploadUI {
      return nil
    }

    return { goBackFromNFC() }
  }

  private var currentDocumentCopySnapshot: DocumentCopySnapshot {
    DocumentCopySnapshot(
      documentName: currentDocumentName,
      documentNameWithArticle: currentDocumentNameWithArticle,
      rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription
    )
  }

  private var currentDocumentName: String {
    session.mrzResult?.userFacingDocumentName ?? defaultDocumentName
  }

  private var currentDocumentNameWithArticle: String {
    session.mrzResult?.userFacingDocumentNameWithArticle ?? defaultDocumentNameWithArticle
  }

  private var currentRFIDSymbolLocationDescription: String {
    session.mrzResult?.userFacingRFIDSymbolLocationDescription ??
      defaultRFIDSymbolLocationDescription
  }

  private var defaultDocumentName: String {
    "document"
  }

  private var defaultDocumentNameWithArticle: String {
    "a document"
  }

  private var defaultRFIDSymbolLocationDescription: String {
    "your document"
  }

  @ViewBuilder
  private func cameraDrawer(for drawer: CameraCaptureDrawer) -> some View {
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
    case .selfie:
      CameraPermissionGate(onCancel: {
        activeCameraDrawer = nil
      }) {
        selfieCaptureDrawer
      }
    }
  }

  private var qrScannerDrawer: some View {
    ZStack {
      QRScannerView { code in
        handleQRCode(code)
      }

      if isResolvingQRCode {
        BlockingLoadingOverlay(message: "Checking verification…")
      }
    }
  }

  private var mrzScannerDrawer: some View {
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
        title: "Scan your document",
        subtitle: "Align the printed code within the box.",
        borderColor: isMRZLocked ? .green : .white,
        borderWidth: 6,
        overlayOpacity: 0.55,
        instructionBottomPadding: CameraDrawerMetrics.instructionBottomPadding
      )
      .allowsHitTesting(false)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var selfieCaptureDrawer: some View {
    SelfieCaptureView(
      onCapture: { images in
        session.selfieImages = images
      },
      onPhotoCaptured: { image, index, total in
        session.selfieImages.append(image)
        let attemptId = session.payload?.attemptId

        Task {
          do {
            _ = try await session.sendSelfieImage(image, index: index, total: total)
          } catch {
            session.handleError(error, forAttemptId: attemptId)
          }
        }
      }
    )
  }

  private var completionMessage: String {
    guard let verdict = session.verdict else {
      return "Your identity verification data has been securely transmitted. You can now close this app and return to your browser."
    }

    if isAcceptedVerdict(verdict) {
      return "Your identity verification data has been securely transmitted. You can now close this app and return to your browser."
    }

    if
      isRejectedVerdict(verdict),
      verdict.retryAllowed,
      let errorMessage = session.errorMessage,
      !errorMessage.isEmpty
    {
      return "\(verdict.reasonMessage)\n\n\(errorMessage)"
    }

    return verdict.reasonMessage
  }

  private var completionPrimaryButtonTitle: String {
    guard let verdict = session.verdict else {
      return "Done"
    }

    if isRejectedVerdict(verdict), verdict.retryAllowed {
      return "Retry Verification"
    }

    return "Done"
  }

  private var completionSecondaryButtonTitle: String? {
    guard let verdict = session.verdict else {
      return nil
    }

    return isRejectedVerdict(verdict) && verdict.retryAllowed ? "Cancel" : nil
  }

  private func handleCompletionPrimaryAction() {
    if let verdict = session.verdict, isRejectedVerdict(verdict), verdict.retryAllowed {
      captureCurrentStepSnapshot()
      let attemptId = session.payload?.attemptId
      Task {
        do {
          try await session.retryVerification()
        } catch {
          session.handleRetryError(error, forAttemptId: attemptId)
        }
      }
      return
    }

    resetVerificationFlow()
  }

  private func handleQRCode(_ code: String) {
    guard !isResolvingQRCode else {
      return
    }

    activeCameraDrawer = nil
    isResolvingQRCode = true

    Task { @MainActor in
      defer {
        isResolvingQRCode = false
      }

      do {
        let payload = try QRCodePayload.parse(from: code)
        try await session.initialize(with: payload)
        session.moveToStep(.mrz)
      } catch {
        session.handleError(error)
      }
    }
  }

  private func startQRScanning() {
    session.moveToStep(.scanning)
    presentQRDrawer()
  }

  private func goBackFromScanning() {
    session.moveToStep(.welcome)
  }

  private func goBackFromMRZ() {
    session.moveToStep(.scanning)
  }

  private func presentCancelVerificationConfirmation() {
    isCancelVerificationConfirmationPresented = true
  }

  private func dismissCancelVerificationConfirmation() {
    isCancelVerificationConfirmationPresented = false
  }

  private func confirmCancelVerification() {
    dismissCancelVerificationConfirmation()
    cancelVerificationFlow()
  }

  private func goBackFromRFIDCheck() {
    session.hasRFIDSymbol = nil
    session.moveToStep(.mrz)
  }

  private func goBackFromRFIDUnsupported() {
    session.hasRFIDSymbol = nil
    session.moveToStep(.rfidCheck)
  }

  private func goBackFromNFC() {
    hasStartedNFCScan = false
    clearRetainedNFCUploadUI()
    resetNFCReaderState()
    session.nfcResult = nil
    session.hasRFIDSymbol = nil
    session.moveToStep(.rfidCheck)
  }

  private func presentQRDrawer() {
    activeCameraDrawer = .qr
  }

  private func presentMRZDrawer() {
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
    activeCameraDrawer = .mrz
    Task {
      await session.updatePhase(.mrzScanning)
    }
  }

  private func handleCameraDrawerDismiss() {
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
  }

  private func startSelfieCapture() {
    session.moveToStep(.selfie)
    presentSelfieDrawer()
    Task {
      await session.updatePhase(.selfieCapturing)
    }
  }

  private func presentSelfieDrawer() {
    activeCameraDrawer = .selfie
  }

  private func startNFCScan() {
    clearRetainedNFCUploadUI()
    hasStartedNFCScan = true
    nfcReader.start(
      mrzKey: session.mrzResult?.mrzKey ?? "",
      cardAccessNumber: cardAccessNumber,
      activeAuthChallenge: session.activeAuthChallenge
    )
  }

  private func captureCurrentStepSnapshot() {
    outgoingStepSnapshot = makeStepRenderSnapshot(for: session.step)
  }

  private func tryAnotherDocument() {
    clearDocumentCaptureUIState()
    session.clearDocumentCaptureState()
    session.moveToStep(.mrz)
  }

  private func resetVerificationFlow() {
    captureCurrentStepSnapshot()
    clearDocumentCaptureUIState()
    session.reset()
  }

  private func cancelVerificationFlow() {
    captureCurrentStepSnapshot()
    let attemptId = session.payload?.attemptId

    Task {
      do {
        try await session.cancelVerification()
        clearDocumentCaptureUIState()
        session.reset()
      } catch {
        session.handleError(error, forAttemptId: attemptId)
      }
    }
  }

  private func makeStepRenderSnapshot(for step: VerificationStep) -> StepRenderSnapshot {
    switch step {
    case .welcome:
      return StepRenderSnapshot(step: .welcome)
    case .scanning:
      return StepRenderSnapshot(
        step: .scanning,
        showsBackButton: session.payload == nil
      )
    case .mrz:
      return StepRenderSnapshot(
        step: .mrz,
        showsBackButton: session.payload == nil,
        showsCancelButton: session.payload != nil
      )
    case .rfidCheck:
      return StepRenderSnapshot(
        step: .rfidCheck,
        showsBackButton: true,
        documentCopy: currentDocumentCopySnapshot
      )
    case .rfidUnsupported:
      return StepRenderSnapshot(
        step: .rfidUnsupported,
        showsBackButton: true,
        documentCopy: currentDocumentCopySnapshot
      )
    case .nfc:
      return StepRenderSnapshot(
        step: .nfc,
        showsBackButton: !isDisplayingNFCUploadUI,
        nfc: NFCRenderSnapshot(
          documentName: currentDocumentName,
          uploadProgress: displayedNFCUploadProgress,
          isUploading: isDisplayingNFCUploadUI,
          hasStarted: hasStartedNFCScan,
          errorMessage: nfcReader.errorMessage,
          result: nfcReader.result
        )
      )
    case .selfieIntro:
      return StepRenderSnapshot(step: .selfieIntro)
    case .selfie:
      return StepRenderSnapshot(step: .selfie)
    case .shareDetails:
      return StepRenderSnapshot(
        step: .shareDetails,
        shareDetails: ShareDetailsRenderSnapshot(
          shareRequest: session.shareRequest,
          selectedShareFieldKeys: session.selectedShareFieldKeys,
          shareSelectionErrorMessage: session.shareSelectionErrorMessage,
          isSubmittingShareSelection: session.isSubmittingShareSelection,
          nfcResult: session.nfcResult,
          mrzResult: session.mrzResult
        )
      )
    case .complete:
      return StepRenderSnapshot(
        step: .complete,
        completion: CompletionRenderSnapshot(
          isSuccess: isAcceptedVerdict(session.verdict),
          message: completionMessage,
          primaryButtonTitle: completionPrimaryButtonTitle,
          secondaryButtonTitle: completionSecondaryButtonTitle
        )
      )
    case .error:
      return StepRenderSnapshot(
        step: .error,
        completion: CompletionRenderSnapshot(
          isSuccess: false,
          message: session.errorMessage ?? "An unexpected error occurred.",
          primaryButtonTitle: "Start Again",
          secondaryButtonTitle: nil
        )
      )
    }
  }

  private func resetNFCReaderState() {
    nfcReader.stop()
  }

  private func clearDocumentCaptureUIState() {
    activeCameraDrawer = nil
    isMRZLocked = false
    cameraBlur = 0
    didTriggerMRZ = false
    cardAccessNumber = nil
    hasStartedNFCScan = false
    clearRetainedNFCUploadUI()
    resetNFCReaderState()
  }

  private var isDisplayingNFCUploadUI: Bool {
    session.isUploadingNFC || isRetainingNFCUploadUI
  }

  private var shouldKeepDeviceAwake: Bool {
    shouldPreventDeviceSleepDuringVerification(
      hasActiveAttempt: session.payload != nil,
      isTerminalStep: session.step == .complete || session.step == .error
    )
  }

  private var displayedNFCUploadProgress: Double {
    if session.isUploadingNFC {
      return session.nfcUploadProgress
    }

    if isRetainingNFCUploadUI {
      return retainedNFCUploadProgress
    }

    return session.nfcUploadProgress
  }

  private func clearRetainedNFCUploadUI() {
    isRetainingNFCUploadUI = false
    retainedNFCUploadProgress = 0
  }

  private func syncIdleTimerState() {
    setIdleTimerDisabled(shouldKeepDeviceAwake)
  }

  private func setIdleTimerDisabled(_ disabled: Bool) {
    UIApplication.shared.isIdleTimerDisabled = disabled
  }

  private func drawerMatchesStep(_ drawer: CameraCaptureDrawer, step: VerificationStep) -> Bool {
    switch drawer {
    case .qr:
      return step == .scanning
    case .mrz:
      return step == .mrz
    case .selfie:
      return step == .selfie
    }
  }
}
