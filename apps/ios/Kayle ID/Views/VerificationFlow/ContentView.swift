import OSLog
import SwiftUI
import UIKit

struct ContentView: View {
  @Binding var pendingQRCode: String?

  enum NavigationDirection {
    case forward
    case backward
  }

  @StateObject var session: VerificationSession
  @StateObject var nfcReader: DocumentNFCReader

  @State var outgoingStepSnapshot: StepRenderSnapshot?
  @State var lastStep: VerificationStep = .welcome
  @State var navDirection: NavigationDirection = .forward
  @State var transitionProgress: CGFloat = 1

  @State var activeCameraDrawer: CameraCaptureDrawer?
  @State var isMRZLocked = false
  @State var cameraBlur: CGFloat = 0
  @State var didTriggerMRZ = false
  @State var cardAccessNumber: String?
  @State var isAboutSheetPresented = false
  @State var isResolvingQRCode = false
  @State var activeQRCodeResolutionID: UUID?
  @State var qrResolutionTimeoutTask: Task<Void, Never>?
  @State var isCancelVerificationConfirmationPresented = false
  @State var hasStartedNFCScan = false
  @State var isRetainingNFCUploadUI = false
  @State var retainedNFCUploadProgress: Double = 0

  let performanceLogger = Logger(
    subsystem: "id.kayle.ios",
    category: "VerificationPerformance"
  )
  let qrInitializationTimeoutNs: UInt64 = 15_000_000_000

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

        if session.isReconnecting {
          BlockingLoadingOverlay(message: String(localized: "Reconnecting…"))
            .transition(.opacity)
        }
      }
      .animation(.easeInOut(duration: 0.2), value: session.isReconnecting)
    }
    .tint(.primary)
    .onAppear {
      lastStep = session.step
      AppAttestService.shared.prewarm(baseURL: APIService.baseURL(from: ""))
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
      } else if session.step == .nfc, session.nfcResult != nil {
        clearRetainedNFCUploadUI()
      }
    }
    .onChange(of: session.isReconnecting) { isReconnecting in
      if isReconnecting {
        clearRetainedNFCUploadUI()
      }
    }
    .onChange(of: session.nfcUploadProgress) { progress in
      if session.step == .nfc, session.isUploadingNFC {
        retainedNFCUploadProgress = progress
      }
    }
    .onChange(of: session.step) { newStep in
      handleStepChange(newStep)
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

  func handleStepChange(_ newStep: VerificationStep) {
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
}
