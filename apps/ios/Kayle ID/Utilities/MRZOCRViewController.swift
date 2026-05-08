import AVFoundation
import UIKit
import Vision

/// MRZ OCR controller using Apple Vision framework.
final class MRZOCRViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate {
  private let session = AVCaptureSession()
  private let videoOutput = AVCaptureVideoDataOutput()
  private let sessionQueue = DispatchQueue(label: "mrz.capture.session")

  private var isProcessing = false
  private var lastMRZ: String?
  private var lastCAN: String?
  var onScan: ((String, String?) -> Void)?

  private nonisolated(unsafe) let textRequest: VNRecognizeTextRequest = {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    return req
  }()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupCamera()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    sessionQueue.async { [session] in
      guard !session.isRunning else { return }
      session.startRunning()
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    sessionQueue.async { [session] in
      guard session.isRunning else { return }
      session.stopRunning()
    }
  }

  private func setupCamera() {
    session.beginConfiguration()
    session.sessionPreset = .high

    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
      let input = try? AVCaptureDeviceInput(device: device),
      session.canAddInput(input)
    else {
      session.commitConfiguration()
      return
    }

    session.addInput(input)

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)

    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    ]
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.setSampleBufferDelegate(self, queue: DispatchQueue(label: "mrz.ocr.queue"))

    guard session.canAddOutput(videoOutput) else {
      session.commitConfiguration()
      return
    }
    session.addOutput(videoOutput)

    if let conn = videoOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if conn.isVideoRotationAngleSupported(90) {
          conn.videoRotationAngle = 90
        }
      } else {
        if conn.isVideoOrientationSupported {
          conn.videoOrientation = .portrait
        }
      }
    }

    session.commitConfiguration()
  }

  // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

  nonisolated func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right, options: [:])

    do {
      try handler.perform([textRequest])
    } catch {
      return
    }

    let results = textRequest.results ?? []

    let lines = results
      .compactMap { $0.topCandidates(1).first }
      .filter { $0.confidence >= 0.4 }
      .map(\.string)

    Task { @MainActor [weak self] in
      guard let self else { return }
      let candidate = extractMRZ(from: lines)
      guard let mrz = candidate else { return }
      let can = extractCAN(from: lines)
      if mrz != self.lastMRZ || can != self.lastCAN {
        self.lastMRZ = mrz
        self.lastCAN = can
        self.isProcessing = false
        self.onScan?(mrz, can)
      } else {
        self.isProcessing = false
      }
    }
  }
}

// MARK: - MRZ extraction helpers

private func extractMRZ(from lines: [String]) -> String? {
  let normalised = lines.map { normaliseMRZish($0) }.filter { !$0.isEmpty }

  let mrzLike = normalised
    .filter { $0.count >= 25 && $0.contains("<<") }

  // TD3 (passport): 2 lines × 44 chars, line 1 starts with "P".
  let td3Candidates = mrzLike.filter { $0.count == 44 }
  if td3Candidates.count >= 2 {
    let ranked = td3Candidates.sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let l1 = ranked[0]
    let l2 = ranked[1]
    if l1.hasPrefix("P") {
      return "\(l1)\n\(l2)"
    }
  }

  // TD1 (ID-1): 3 lines × 30 chars. Line 3 carries the name; line 1 starts
  // with the document type code (typically "I", "A", or "C"). Prefer this
  // over TD2 when 3 thirty-char candidates are available.
  let td1Candidates = mrzLike.filter { $0.count == 30 }
  if td1Candidates.count >= 3 {
    let ranked = td1Candidates.sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let top = Array(ranked.prefix(3))
    if let header = top.first(where: { mrzLineLooksLikeDocumentHeader($0) }) {
      let rest = top.filter { $0 != header }
      if rest.count >= 2 {
        return "\(header)\n\(rest[0])\n\(rest[1])"
      }
    }
  }

  // TD2 (ID-2): 2 lines × 36 chars, line 1 starts with the document type code.
  let td2Candidates = mrzLike.filter { $0.count == 36 }
  if td2Candidates.count >= 2 {
    let ranked = td2Candidates.sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let l1 = ranked[0]
    let l2 = ranked[1]
    if mrzLineLooksLikeDocumentHeader(l1) {
      return "\(l1)\n\(l2)"
    }
    if mrzLineLooksLikeDocumentHeader(l2) {
      return "\(l2)\n\(l1)"
    }
  }

  return nil
}

private func mrzLineLooksLikeDocumentHeader(_ s: String) -> Bool {
  guard let first = s.first else { return false }
  return first == "P" || first == "I" || first == "A" || first == "C"
}

private func normaliseMRZish(_ s: String) -> String {
  let up = s.uppercased().replacingOccurrences(of: " ", with: "")
  let allowed = up.filter { ch in
    (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch == "<"
  }
  return String(allowed)
}

private func scoreMRZLine(_ s: String) -> Int {
  let lt = s.count(where: { $0 == "<" })
  return lt * 10 + s.count
}

private func extractCAN(from lines: [String]) -> String? {
  let eligibleLines = lines.filter { !$0.contains("<") }
  let labeledLines = eligibleLines.filter { line in
    let up = line.uppercased()
    return up.contains("CAN") || up.contains("CARD") || up.contains("ACCESS")
  }

  let labeledCandidates = labeledLines
    .flatMap { digitRuns(in: $0) }
    .filter { $0.count == 6 }

  if let match = labeledCandidates.first {
    return match
  }

  let candidates = eligibleLines
    .flatMap { digitRuns(in: $0) }
    .filter { $0.count == 6 }

  return candidates.first
}

private func digitRuns(in s: String) -> [String] {
  var runs: [String] = []
  var current = ""

  for ch in s {
    if ch >= "0" && ch <= "9" {
      current.append(ch)
    } else if !current.isEmpty {
      runs.append(current)
      current = ""
    }
  }

  if !current.isEmpty {
    runs.append(current)
  }

  return runs
}
