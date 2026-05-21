import SwiftUI

struct LivenessCaptureView: View {
  let onComplete: () -> Void
  let onRejected: () -> Void
  let onError: (Error) -> Void

  @EnvironmentObject private var session: VerificationSession
  @StateObject private var engine = LivenessEngine()
  @Environment(\.scenePhase) private var scenePhase
  @State private var successBlur: CGFloat = 0

  var body: some View {
    ZStack {
      Color.black.ignoresSafeArea()

      LivenessCameraPreview(engine: engine)
        .ignoresSafeArea()
        .blur(radius: successBlur)

      LivenessOverlay(state: engine.state)
        .ignoresSafeArea()
        .allowsHitTesting(false)

      VStack {
        instructionStack
          .padding(.horizontal, 24)
          .padding(.top, 24)
        Spacer()
      }
    }
    .task {
      engine.challengeNonce = session.livenessChallenge?.challengeNonce
      do {
        try await engine.start()
      } catch {
        onError(error)
      }
    }
    .onChange(of: session.livenessChallenge?.challengeNonce) { newNonce in
      engine.challengeNonce = newNonce
    }
    .onChange(of: engine.recordedVideoURL) { newURL in
      guard let url = newURL else { return }
      Task { await uploadRecording(url) }
    }
    .onChange(of: engine.fatalError) { fatalError in
      if let fatalError {
        onError(fatalError)
      }
    }
    .onChange(of: engine.state.stage) { stage in
      let shouldBlur = stage == .finishing || stage == .uploading
      withAnimation(.easeInOut(duration: 1.0)) {
        successBlur = shouldBlur ? 8 : 0
      }
    }
    .onChange(of: scenePhase) { newPhase in
      if newPhase != .active {
        engine.cancel()
      }
    }
    .onDisappear {
      engine.cancel()
    }
  }

  @ViewBuilder
  private var instructionStack: some View {
    switch engine.state.stage {
    case .framing:
      LivenessInstructionPill(
        title: String(localized: "Position your face in the frame"),
        subtitle: String(
          localized: "Make sure your face is well-lit and clearly visible"
        )
      )
    case .recording:
      LivenessInstructionPill(
        title: String(localized: "Turn your head left and right"),
        subtitle: String(
          localized: "Move slowly so the arcs around your face fill up"
        )
      )
    case .finishing:
      LivenessInstructionPill(
        title: String(localized: "Almost done…"),
        subtitle: String(localized: "Hold still for a moment")
      )
    case .uploading:
      LivenessInstructionPill(
        title: String(localized: "Uploading…"),
        subtitle: String(
          localized:
            "Keep this screen open while we finish the secure transfer."
        )
      )
    }
  }

  @MainActor
  private func uploadRecording(_ url: URL) async {
    engine.markUploading()
    do {
      session.livenessVideoURL = url
      let completed = try await session.sendLivenessVideo(url)
      if completed {
        onComplete()
      } else {
        onRejected()
      }
    } catch {
      onError(error)
    }
  }
}
