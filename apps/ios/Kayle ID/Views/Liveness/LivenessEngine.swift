@preconcurrency import AVFoundation
import Combine
import SwiftUI
import UIKit
import Vision

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
  @Published private(set) var debugYawDegrees: Double = 0 {
    willSet { objectWillChange.send() }
  }

  private let yawTargetDegrees: Double = 22
  private let centeringYawDegrees: Double = 12
  private let framesPerSecond: Int32 = 24
  private let bitRate: Int = 1_600_000
  private let maxRecordingSeconds: TimeInterval = 12
  private let trackerStride = 3
  private let centerHoldFrames = 6

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

  private let landmarksRequest = VNDetectFaceLandmarksRequest()
  private let visionSequenceHandler = VNSequenceRequestHandler()
  private var frameCounter = 0
  private var consecutiveCenteredFrames = 0

  private var startedRecordingAt: Date?
  private var hasFinishedRecording = false
  private var hasReportedFinalURL = false
  private var maxLeftYawDeg: Double = 0
  private var maxRightYawDeg: Double = 0

  var challengeNonce: Data?

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
      consecutiveCenteredFrames >= centerHoldFrames,
      challengeNonce != nil
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
    let tempURL = try makeTempURL()
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

    assetWriter = writer
    videoInput = input
    pixelBufferAdaptor = adaptor
    outputURL = tempURL
    sessionStartTime = nil
    isWritingFrames = true
    startedRecordingAt = Date()

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
      input.isReadyForMoreMediaData,
      let nonce = challengeNonce
    else {
      return
    }
    do {
      try LivenessNonceStamp.stamp(into: pixelBuffer, nonce: nonce)
    } catch {
      isWritingFrames = false
      writer.cancelWriting()
      cleanup(removingFile: true)
      fatalError = .captureFailed
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
        do {
          try LivenessTempFileStore.protectRecording(at: url)
        } catch {
          self.cleanup(removingFile: true)
          self.fatalError = LivenessError.captureFailed
          return
        }

        if !self.hasReportedFinalURL {
          self.hasReportedFinalURL = true
          self.recordedVideoURL = url
        }
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
      if connection.isVideoMirroringSupported {
        connection.automaticallyAdjustsVideoMirroring = false
        connection.isVideoMirrored = false
      }
    }
  }

  private func makeTempURL() throws -> URL {
    try LivenessTempFileStore.makeRecordingURL()
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
