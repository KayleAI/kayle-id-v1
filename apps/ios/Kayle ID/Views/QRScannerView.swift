import AVFoundation
import SwiftUI

struct QRScannerView: View {
  let onScan: (String) -> Void
  var isConnecting = false
  var connectingMessage = String(localized: "Connecting securely...")

  @State private var isScanning = true
  @State private var lastScannedCode: String?

  var body: some View {
    ZStack {
      if PreviewSupport.isRunningInXcodePreview {
        Color.black.ignoresSafeArea()
          .blur(radius: cameraBlur)
          .animation(.easeInOut(duration: 1.0), value: isConnecting)
      } else {
        QRScannerViewController(
          onScan: { code in
            guard isScanning, code != lastScannedCode else { return }
            lastScannedCode = code
            isScanning = false
            onScan(code)
          }
        )
        .ignoresSafeArea()
        .blur(radius: cameraBlur)
        .animation(.easeInOut(duration: 1.0), value: isConnecting)
      }

      ScannerOverlayView(
        cutout: .centeredSquare(
          size: QRScannerMetrics.cutoutSize,
          cornerRadius: QRScannerMetrics.cutoutCornerRadius
        ),
        title: String(localized: "Scan QR Code"),
        subtitle: String(
          localized: "Point your camera at the QR code on the screen"
        ),
        borderColor: isConnecting ? .green : .white,
        borderWidth: isConnecting ? 6 : 4,
        instructionHorizontalPadding: 32,
        instructionBottomPadding: CameraDrawerMetrics.instructionBottomPadding
      )
      .animation(.easeInOut(duration: 0.25), value: isConnecting)

      if isConnecting {
        QRScannerConnectionStatus(message: connectingMessage)
      }
    }
  }

  private var cameraBlur: CGFloat {
    isConnecting ? QRScannerMetrics.lockedBlurRadius : 0
  }
}

private enum QRScannerMetrics {
  static let cutoutSize: CGFloat = 250
  static let cutoutCornerRadius: CGFloat = 24
  static let lockedBlurRadius: CGFloat = 8
}

private struct QRScannerConnectionStatus: View {
  let message: String

  var body: some View {
    ZStack {
      LoadingStatusRow(message: message, tone: .light)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.black.opacity(0.65), in: Capsule())
        .frame(width: QRScannerMetrics.cutoutSize - 32)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .ignoresSafeArea()
    .allowsHitTesting(true)
  }
}

struct QRScannerViewController: UIViewControllerRepresentable {
  let onScan: (String) -> Void

  func makeUIViewController(context: Context) -> QRCameraViewController {
    let controller = QRCameraViewController()
    controller.onScan = onScan
    return controller
  }

  func updateUIViewController(_ uiViewController: QRCameraViewController, context: Context) {}
}

final class QRCameraViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onScan: ((String) -> Void)?

  private let session = AVCaptureSession()
  private let metadataOutput = AVCaptureMetadataOutput()
  private let sessionQueue = DispatchQueue(label: "qr.capture.session")

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    setupCamera()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    sessionQueue.async { [session] in
      if !session.isRunning {
        session.startRunning()
      }
    }
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    sessionQueue.async { [session] in
      if session.isRunning {
        session.stopRunning()
      }
    }
  }

  private func setupCamera() {
    session.beginConfiguration()

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

    guard session.canAddOutput(metadataOutput) else {
      session.commitConfiguration()
      return
    }

    session.addOutput(metadataOutput)
    metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
    metadataOutput.metadataObjectTypes = [.qr]

    session.commitConfiguration()
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    if let preview = view.layer.sublayers?.first(where: { $0 is AVCaptureVideoPreviewLayer }) as? AVCaptureVideoPreviewLayer {
      preview.frame = view.bounds
    }
  }

  nonisolated func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
          object.type == .qr,
          let stringValue = object.stringValue
    else { return }

    guard stringValue.hasPrefix("kayle-id://") else { return }

    Task { @MainActor in
      self.onScan?(stringValue)
    }
  }
}
