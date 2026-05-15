@preconcurrency import AVFoundation
import Combine
import SwiftUI
import UIKit
import Vision

// MARK: - Public View

/// Drives the head-movement liveness flow. There is no server-issued
/// pose challenge in v2 — the user freely turns left and right in either
/// order, and the server validates the recorded video for both extremes.
///
/// TODO(liveness-nonce-extraction): embed
/// `session.livenessChallenge?.challengeNonce` in the recorded video so
/// the verifier (matching TODO in `service.py`) can bind the clip to
/// this attempt. Until both halves land, the nonce is telemetry only.
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
      do {
        try await engine.start()
      } catch {
        onError(error)
      }
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
      let accepted = try await session.sendLivenessVideo(url)
      if accepted {
        onComplete()
      } else {
        onRejected()
      }
    } catch {
      onError(error)
    }
  }
}

// MARK: - Instruction Pill

private struct LivenessInstructionPill: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(spacing: 6) {
      Text(title)
        .font(.title3.weight(.semibold))
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
      Text(subtitle)
        .font(.subheadline)
        .foregroundStyle(.white.opacity(0.85))
        .multilineTextAlignment(.center)
    }
    .shadow(color: .black.opacity(0.7), radius: 6, x: 0, y: 1)
  }
}

// MARK: - Overlay (mask + arcs)

private struct LivenessOverlay: View {
  let state: LivenessUIState

  private let cornerRadius: CGFloat = 44

  var body: some View {
    GeometryReader { proxy in
      let frame = proxy.frame(in: .local)
      let centre = CGPoint(x: frame.midX, y: frame.midY)
      let cutoutSize = cutoutSize(for: frame.size)
      let cutoutRect = CGRect(
        x: centre.x - cutoutSize.width / 2,
        y: centre.y - cutoutSize.height / 2,
        width: cutoutSize.width,
        height: cutoutSize.height
      )

      ZStack {
        ZStack {
          Rectangle()
            .fill(.ultraThinMaterial)
            .opacity(0.4)
            .ignoresSafeArea()
          Color.black.opacity(0.22)
            .ignoresSafeArea()
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .frame(width: cutoutRect.width, height: cutoutRect.height)
            .position(x: cutoutRect.midX, y: cutoutRect.midY)
            .blendMode(.destinationOut)
        }
        .compositingGroup()

        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .stroke(
            .white.opacity(0.45),
            style: StrokeStyle(lineWidth: 4)
          )
          .frame(width: cutoutRect.width, height: cutoutRect.height)
          .position(x: cutoutRect.midX, y: cutoutRect.midY)

        LivenessProgressArc(
          progress: state.rightProgress,
          side: .right,
          cornerRadius: cornerRadius
        )
        .stroke(
          arcColour(for: state.rightProgress),
          style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round)
        )
        .frame(width: cutoutRect.width, height: cutoutRect.height)
        .position(x: cutoutRect.midX, y: cutoutRect.midY)
        .animation(.easeOut(duration: 0.12), value: state.rightProgress)

        LivenessProgressArc(
          progress: state.leftProgress,
          side: .left,
          cornerRadius: cornerRadius
        )
        .stroke(
          arcColour(for: state.leftProgress),
          style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round)
        )
        .frame(width: cutoutRect.width, height: cutoutRect.height)
        .position(x: cutoutRect.midX, y: cutoutRect.midY)
        .animation(.easeOut(duration: 0.12), value: state.leftProgress)
      }
    }
  }

  private func cutoutSize(for size: CGSize) -> CGSize {
    let width = min(size.width * 0.78, 300)
    let height = width * 1.25
    return CGSize(width: width, height: height)
  }

  private func arcColour(for progress: Double) -> Color {
    if progress >= 1.0 {
      return Color.green
    }
    let normalized = max(0, min(1, progress))
    let red = 1.0 - normalized
    let green = 1.0
    let blue = 1.0 - normalized * 0.9
    return Color(red: red, green: green, blue: blue)
  }
}

private struct LivenessProgressArc: Shape {
  enum Side {
    case left
    case right
  }

  var progress: Double
  let side: Side
  let cornerRadius: CGFloat

  var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func path(in rect: CGRect) -> Path {
    var combined = Path()
    let clamped = max(0.0, min(1.0, progress))
    if clamped <= 0 {
      return combined
    }

    let perimeter = sidePerimeter(in: rect)
    combined.addPath(perimeter.trimmedPath(from: 0, to: clamped * 0.5))
    combined.addPath(perimeter.trimmedPath(from: 1 - clamped * 0.5, to: 1))
    return combined
  }

  private func sidePerimeter(in rect: CGRect) -> Path {
    var path = Path()
    let r = min(cornerRadius, min(rect.width, rect.height) / 2)
    let xSign: CGFloat = side == .left ? -1 : 1

    path.move(to: CGPoint(x: rect.midX, y: rect.minY))

    let topCornerEntry = CGPoint(
      x: rect.midX + xSign * (rect.width / 2 - r),
      y: rect.minY
    )
    path.addLine(to: topCornerEntry)

    let topCornerCentre = CGPoint(
      x: side == .left ? rect.minX + r : rect.maxX - r,
      y: rect.minY + r
    )
    appendCorner(
      to: &path,
      centre: topCornerCentre,
      radius: r,
      startAngle: -.pi / 2,
      sweep: side == .left ? -.pi / 2 : .pi / 2
    )

    let bottomCornerEntry = CGPoint(
      x: side == .left ? rect.minX : rect.maxX,
      y: rect.maxY - r
    )
    path.addLine(to: bottomCornerEntry)

    let bottomCornerCentre = CGPoint(
      x: side == .left ? rect.minX + r : rect.maxX - r,
      y: rect.maxY - r
    )
    appendCorner(
      to: &path,
      centre: bottomCornerCentre,
      radius: r,
      startAngle: side == .left ? .pi : 0,
      sweep: side == .left ? -.pi / 2 : .pi / 2
    )

    path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))

    return path
  }

  private func appendCorner(
    to path: inout Path,
    centre: CGPoint,
    radius: CGFloat,
    startAngle: CGFloat,
    sweep: CGFloat
  ) {
    let steps = 24
    for i in 1...steps {
      let t = CGFloat(i) / CGFloat(steps)
      let angle = startAngle + sweep * t
      let point = CGPoint(
        x: centre.x + radius * cos(angle),
        y: centre.y + radius * sin(angle)
      )
      path.addLine(to: point)
    }
  }
}

// MARK: - Camera Preview

struct LivenessCameraPreview: UIViewRepresentable {
  let engine: LivenessEngine

  func makeUIView(context: Context) -> LivenessPreviewView {
    let view = LivenessPreviewView()
    view.previewLayer.videoGravity = .resizeAspectFill
    engine.attach(previewLayer: view.previewLayer)
    return view
  }

  func updateUIView(_ uiView: LivenessPreviewView, context: Context) {
    engine.attach(previewLayer: uiView.previewLayer)
  }
}

final class LivenessPreviewView: UIView {
  override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
  var previewLayer: AVCaptureVideoPreviewLayer {
    // swiftlint:disable:next force_cast
    layer as! AVCaptureVideoPreviewLayer
  }
}

// MARK: - Engine

enum LivenessStage: Equatable {
  case framing
  case recording
  case finishing
  case uploading
}

struct LivenessUIState: Equatable {
  var stage: LivenessStage = .framing
  var leftProgress: Double = 0
  var rightProgress: Double = 0
}

@MainActor
final class LivenessEngine: ObservableObject {
  // No @Published members triggering the synthesis — provide an explicit
  // objectWillChange so the @MainActor isolation doesn't break Combine's
  // default conformance.
  nonisolated let objectWillChange = ObservableObjectPublisher()

  @Published private(set) var state = LivenessUIState() {
    willSet { objectWillChange.send() }
  }
  @Published private(set) var recordedVideoURL: URL? {
    willSet { objectWillChange.send() }
  }
  @Published private(set) var fatalError: LivenessError? {
    willSet { objectWillChange.send() }
  }
  /// Live yaw value (degrees) — only surfaced in DEBUG builds for tuning.
  @Published private(set) var debugYawDegrees: Double = 0 {
    willSet { objectWillChange.send() }
  }

  // On-device geometric yaw and server-side solvePnP yaw disagree on
  // absolute magnitudes but share sign convention (positive = subject's
  // left). iOS targets 22° so 100% progress lands comfortably past the
  // server's 17° PnP-scale tilt threshold.
  private let yawTargetDegrees: Double = 22
  private let centeringYawDegrees: Double = 12 // |yaw| under this counts as "centred"
  private let framesPerSecond: Int32 = 24
  private let bitRate: Int = 1_600_000
  private let maxRecordingSeconds: TimeInterval = 12
  // Vision pose estimation is expensive; sample roughly every 3rd frame.
  private let trackerStride = 3
  // Consecutive in-zone frames before promoting to recording. Avoids
  // flicker on a single false positive.
  private let centerHoldFrames = 6

  // AV pipeline
  private let captureSession = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let videoQueue = DispatchQueue(label: "com.kayle.liveness.video")
  private let sampleBufferDelegate = LivenessSampleBufferDelegate()
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var sessionStartTime: CMTime?
  private var outputURL: URL?
  private var isWritingFrames = false
  private weak var previewLayer: AVCaptureVideoPreviewLayer?

  // Vision pipeline
  private let landmarksRequest = VNDetectFaceLandmarksRequest()
  private let visionSequenceHandler = VNSequenceRequestHandler()
  private var frameCounter = 0
  private var consecutiveCenteredFrames = 0

  // Recording lifecycle
  private var startedRecordingAt: Date?
  private var hasFinishedRecording = false
  private var hasReportedFinalURL = false
  // Stored in degrees, matching the server's classifier.
  private var maxLeftYawDeg: Double = 0
  private var maxRightYawDeg: Double = 0

  init() {
    sampleBufferDelegate.engine = self
    captureSession.sessionPreset = .hd1280x720
  }

  func attach(previewLayer: AVCaptureVideoPreviewLayer) {
    previewLayer.session = captureSession
    self.previewLayer = previewLayer
  }

  func start() async throws {
    if captureSession.inputs.isEmpty {
      try configureSession()
    }
    if !captureSession.isRunning {
      let session = captureSession
      await withCheckedContinuation {
        (continuation: CheckedContinuation<Void, Never>) in
        videoQueue.async {
          session.startRunning()
          continuation.resume()
        }
      }
    }
  }

  func cancel() {
    isWritingFrames = false
    videoInput?.markAsFinished()
    assetWriter?.cancelWriting()
    cleanup(removingFile: true)
    let session = captureSession
    videoQueue.async {
      if session.isRunning {
        session.stopRunning()
      }
    }
  }

  func markUploading() {
    state = LivenessUIState(
      stage: .uploading,
      leftProgress: state.leftProgress,
      rightProgress: state.rightProgress
    )
  }

  // Called from the sample buffer delegate on the video queue. Hops to the
  // main actor before touching `state` and the AVAssetWriter handle.
  nonisolated fileprivate func ingestSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
      return
    }
    let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

    Task { @MainActor in
      self.handleFrame(
        pixelBuffer: pixelBuffer,
        presentationTime: presentationTime
      )
    }
  }

  private func handleFrame(
    pixelBuffer: CVPixelBuffer,
    presentationTime: CMTime
  ) {
    appendFrameToWriter(
      pixelBuffer: pixelBuffer,
      presentationTime: presentationTime
    )

    frameCounter &+= 1
    if frameCounter % trackerStride != 0 {
      return
    }
    runVisionInference(on: pixelBuffer)
    advanceStageIfNeeded()

    if let startedRecordingAt {
      let elapsed = Date().timeIntervalSince(startedRecordingAt)
      if elapsed >= maxRecordingSeconds {
        finishRecording()
      }
    }
  }

  private func runVisionInference(on pixelBuffer: CVPixelBuffer) {
    do {
      // Buffer is captured portrait + un-mirrored (we set
      // `videoOrientation = .portrait` and disabled mirroring on the
      // capture connection), so Vision should see it as `.up`.
      try visionSequenceHandler.perform(
        [landmarksRequest],
        on: pixelBuffer,
        orientation: .up
      )
    } catch {
      return
    }

    guard let face = landmarksRequest.results?.first else {
      consecutiveCenteredFrames = 0
      return
    }

    let yawDeg = geometricYawDegrees(for: face)
    debugYawDegrees = yawDeg ?? 0

    switch state.stage {
    case .framing:
      let isCentered =
        yawDeg != nil
        && abs(yawDeg ?? 0) <= centeringYawDegrees
        && faceFillsFraming(face.boundingBox)
      consecutiveCenteredFrames = isCentered ? consecutiveCenteredFrames + 1 : 0
    case .recording:
      guard let yawDeg else { return }
      // Sign convention matches service.py `estimate_yaw_deg` exactly:
      //   yawDeg > 0  ⇒ nose has rotated to image-right ⇒ subject turned
      //                 to their own LEFT (un-mirrored capture).
      //   yawDeg < 0  ⇒ subject turned to their own RIGHT.
      if yawDeg > maxLeftYawDeg {
        maxLeftYawDeg = yawDeg
      }
      if -yawDeg > maxRightYawDeg {
        maxRightYawDeg = -yawDeg
      }
      updateProgress()
    case .finishing, .uploading:
      break
    }
  }

  /// On-device geometric yaw approximation driving the progress arcs.
  /// Positive yaw = subject turned to their own LEFT. Returns nil
  /// when any required landmark is missing.
  private func geometricYawDegrees(for face: VNFaceObservation) -> Double? {
    guard
      let landmarks = face.landmarks,
      let leftEye = landmarks.leftEye?.normalizedPoints,
      let rightEye = landmarks.rightEye?.normalizedPoints,
      let nose = landmarks.nose?.normalizedPoints,
      !leftEye.isEmpty,
      !rightEye.isEmpty,
      !nose.isEmpty
    else {
      return nil
    }

    let leftCenter = centroid(of: leftEye)
    let rightCenter = centroid(of: rightEye)
    let noseCenter = centroid(of: nose)

    let interOcular = abs(leftCenter.x - rightCenter.x)
    guard interOcular > 1e-4 else { return nil }

    let midX = (leftCenter.x + rightCenter.x) / 2
    let noseOffset = Double(noseCenter.x - midX)
    let ratio = noseOffset / Double(interOcular)
    return atan(ratio * 2.0) * 180 / .pi
  }

  private func centroid(of points: [CGPoint]) -> CGPoint {
    var sumX: CGFloat = 0
    var sumY: CGFloat = 0
    for point in points {
      sumX += point.x
      sumY += point.y
    }
    let count = CGFloat(points.count)
    return CGPoint(x: sumX / count, y: sumY / count)
  }

  private func faceFillsFraming(_ boundingBox: CGRect) -> Bool {
    // Vision returns coordinates in normalized image space (origin at the
    // bottom-left). A reasonably-framed portrait face spans ~30% of either
    // dimension; require at least 18% to be permissive.
    boundingBox.width >= 0.18 && boundingBox.height >= 0.18
  }

  private func updateProgress() {
    let left = min(1.0, maxLeftYawDeg / yawTargetDegrees)
    let right = min(1.0, maxRightYawDeg / yawTargetDegrees)
    state = LivenessUIState(
      stage: .recording,
      leftProgress: left,
      rightProgress: right
    )

    if left >= 1.0 && right >= 1.0 && !hasFinishedRecording {
      finishRecording()
    }
  }

  private func advanceStageIfNeeded() {
    guard state.stage == .framing,
      consecutiveCenteredFrames >= centerHoldFrames
    else {
      return
    }
    do {
      try beginRecording()
    } catch {
      fatalError = .captureFailed
    }
  }

  private func beginRecording() throws {
    let tempURL = makeTempURL()
    let writer = try AVAssetWriter(outputURL: tempURL, fileType: .mp4)

    let outputSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: 720,
      AVVideoHeightKey: 1280,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: bitRate,
        AVVideoMaxKeyFrameIntervalKey: framesPerSecond,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264BaselineAutoLevel,
      ],
    ]

    let input = AVAssetWriterInput(
      mediaType: .video,
      outputSettings: outputSettings
    )
    input.expectsMediaDataInRealTime = true
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input,
      sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String:
          Int(kCVPixelFormatType_32BGRA),
        kCVPixelBufferWidthKey as String: 720,
        kCVPixelBufferHeightKey as String: 1280,
      ]
    )

    guard writer.canAdd(input) else {
      throw LivenessError.captureFailed
    }
    writer.add(input)

    self.assetWriter = writer
    self.videoInput = input
    self.pixelBufferAdaptor = adaptor
    self.outputURL = tempURL
    self.sessionStartTime = nil
    self.isWritingFrames = true
    self.startedRecordingAt = Date()

    writer.startWriting()

    state = LivenessUIState(stage: .recording, leftProgress: 0, rightProgress: 0)
  }

  private func appendFrameToWriter(
    pixelBuffer: CVPixelBuffer,
    presentationTime: CMTime
  ) {
    guard isWritingFrames,
      let writer = assetWriter,
      let input = videoInput,
      let adaptor = pixelBufferAdaptor,
      writer.status == .writing,
      input.isReadyForMoreMediaData
    else {
      return
    }
    if sessionStartTime == nil {
      writer.startSession(atSourceTime: presentationTime)
      sessionStartTime = presentationTime
    }
    _ = adaptor.append(pixelBuffer, withPresentationTime: presentationTime)
  }

  private func finishRecording() {
    guard !hasFinishedRecording else { return }
    hasFinishedRecording = true
    isWritingFrames = false
    state = LivenessUIState(
      stage: .finishing,
      leftProgress: state.leftProgress,
      rightProgress: state.rightProgress
    )

    guard
      let writer = assetWriter,
      let input = videoInput,
      let url = outputURL
    else {
      cleanup(removingFile: true)
      return
    }

    input.markAsFinished()
    writer.finishWriting { [weak self] in
      Task { @MainActor in
        guard let self else { return }
        guard writer.status == .completed else {
          self.cleanup(removingFile: true)
          self.fatalError = LivenessError.captureFailed
          return
        }

        if !self.hasReportedFinalURL {
          self.hasReportedFinalURL = true
          self.recordedVideoURL = url
        }
        // Leave the session running so the preview doesn't freeze
        // while uploading; `cancel()` tears it down on disappear.
      }
    }
  }

  private func configureSession() throws {
    captureSession.beginConfiguration()
    defer { captureSession.commitConfiguration() }

    guard
      let device = AVCaptureDevice.default(
        .builtInWideAngleCamera,
        for: .video,
        position: .front
      )
    else {
      throw LivenessError.captureFailed
    }

    let input = try AVCaptureDeviceInput(device: device)
    guard captureSession.canAddInput(input) else {
      throw LivenessError.captureFailed
    }
    captureSession.addInput(input)

    videoOutput.alwaysDiscardsLateVideoFrames = false
    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String:
        Int(kCVPixelFormatType_32BGRA)
    ]
    videoOutput.setSampleBufferDelegate(sampleBufferDelegate, queue: videoQueue)

    guard captureSession.canAddOutput(videoOutput) else {
      throw LivenessError.captureFailed
    }
    captureSession.addOutput(videoOutput)
    if let connection = videoOutput.connection(with: .video) {
      if connection.isVideoOrientationSupported {
        connection.videoOrientation = .portrait
      }
      // Do NOT mirror — the server YuNet pose geometry assumes an
      // un-mirrored front-camera buffer. The preview layer mirrors itself
      // automatically so the user still sees a selfie-style image on screen.
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
  }

  private func makeTempURL() -> URL {
    let tempDir = FileManager.default.temporaryDirectory
    let filename = "liveness-\(UUID().uuidString).mp4"
    return tempDir.appendingPathComponent(filename)
  }

  private func cleanup(removingFile: Bool) {
    if removingFile, let url = outputURL {
      try? FileManager.default.removeItem(at: url)
    }
    assetWriter = nil
    videoInput = nil
    pixelBufferAdaptor = nil
    outputURL = nil
    sessionStartTime = nil
  }
}

// MARK: - Sample Buffer Delegate

final class LivenessSampleBufferDelegate: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate
{
  weak var engine: LivenessEngine?

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    engine?.ingestSampleBuffer(sampleBuffer)
  }
}
