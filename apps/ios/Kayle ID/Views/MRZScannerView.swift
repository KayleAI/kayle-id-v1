import SwiftUI

/// Standalone MRZ scanner view - can be used in App Clips or main app.
/// Scans and validates Machine Readable Zone (MRZ) from identity documents.
struct MRZScannerView: UIViewControllerRepresentable {
  let onValidMRZ: (String, MRZResult, String?) -> Void

  func makeUIViewController(context: Context) -> UIViewController {
    if PreviewSupport.isRunningInXcodePreview {
      let controller = UIViewController()
      let hostingController = UIHostingController(
        rootView: PreviewCameraSurfaceView(
          title: "Photo page scan preview",
          subtitle: "Canvas shows a placeholder instead of live camera input."
        )
      )

      controller.view.backgroundColor = .black
      controller.addChild(hostingController)
      hostingController.view.frame = controller.view.bounds
      hostingController.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      hostingController.view.translatesAutoresizingMaskIntoConstraints = true
      controller.view.addSubview(hostingController.view)
      hostingController.didMove(toParent: controller)
      return controller
    }

    let vc = MRZOCRViewController()
    vc.onScan = { mrz, can in
      guard
        let res = try? MRZParser.parseAndValidate(mrz),
        res.format == .td3,
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
