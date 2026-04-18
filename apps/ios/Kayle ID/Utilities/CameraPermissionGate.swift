import AVFoundation
import SwiftUI
import UIKit

enum CameraPermissionGateState {
  case authorized
  case notDetermined
  case deniedOrRestricted
}

struct CameraPermissionGate<Destination: View>: View {
  @Environment(\.scenePhase) private var scenePhase
  @State private var permissionState: CameraPermissionGateState

  let onCancel: () -> Void
  private let destination: Destination
  private let previewPermissionState: CameraPermissionGateState?

  init(
    previewPermissionState: CameraPermissionGateState? = nil,
    onCancel: @escaping () -> Void,
    @ViewBuilder destination: () -> Destination
  ) {
    self.previewPermissionState = previewPermissionState
    self.onCancel = onCancel
    self.destination = destination()
    _permissionState = State(initialValue: previewPermissionState ?? .notDetermined)
  }

  var body: some View {
    ZStack {
      switch permissionState {
      case .authorized:
        destination
      case .notDetermined:
        prePermissionView
      case .deniedOrRestricted:
        deniedView
      }
    }
    .onAppear(perform: refreshPermissionState)
    .onChange(of: scenePhase) { newPhase in
      guard newPhase == .active else { return }
      refreshPermissionState()
    }
  }

  private var prePermissionView: some View {
    permissionStepView(
      title: "Enable camera to scan your document",
      subtitle: "We use the camera to scan the lines at the bottom of your document. This is required to read document data.",
      primaryButtonTitle: "Enable camera",
      onPrimaryAction: requestCameraAccess
    )
  }

  private var deniedView: some View {
    permissionStepView(
      title: "Camera access required",
      subtitle: "Without camera access, the app can't scan your document and can't read your document chip.",
      primaryButtonTitle: "Open Settings",
      onPrimaryAction: openAppSettings
    )
  }

  private func refreshPermissionState() {
    permissionState = previewPermissionState ?? mapPermissionState()
  }

  private func requestCameraAccess() {
    AVCaptureDevice.requestAccess(for: .video) { granted in
      DispatchQueue.main.async {
        permissionState = granted ? .authorized : .deniedOrRestricted
      }
    }
  }

  private func openAppSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
  }

  private func mapPermissionState() -> CameraPermissionGateState {
    if PreviewSupport.isRunningInXcodePreview {
      return .authorized
    }

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      return .authorized
    case .notDetermined:
      return .notDetermined
    case .denied, .restricted:
      return .deniedOrRestricted
    @unknown default:
      return .deniedOrRestricted
    }
  }

  private func permissionStepView(
    title: String,
    subtitle: String,
    primaryButtonTitle: String,
    onPrimaryAction: @escaping () -> Void
  ) -> some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .step,
        visual: nil,
        title: title,
        subtitle: subtitle
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(style: .primary, title: primaryButtonTitle, action: onPrimaryAction)
      ActionButton(style: .secondary, title: "Cancel", action: onCancel)
    }
  }
}
