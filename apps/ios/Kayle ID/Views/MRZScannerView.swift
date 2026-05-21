import SwiftUI

struct MRZScannerView: UIViewControllerRepresentable {
  let onValidMRZ: (String, MRZResult, String?) -> Void

  func makeUIViewController(context: Context) -> UIViewController {
    if PreviewSupport.isRunningInXcodePreview {
      // Canvas previews can't spin up a real AVCaptureSession; hand back a
      // plain black-backed controller so the surrounding layout still
      // renders without crashing on the missing camera hardware.
      let controller = UIViewController()
      controller.view.backgroundColor = .black
      return controller
    }

    let vc = MRZOCRViewController()
    vc.onScan = { mrz, can in
      guard
        let res = try? MRZParser.parseAndValidate(mrz),
        res.checks.isValid
      else {
        return
      }
      onValidMRZ(mrz, res, can)
    }
    return vc
  }

  func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
