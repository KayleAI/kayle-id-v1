import Foundation

enum PreviewSupport {
  /// True when the process is hosting an Xcode Canvas preview. The camera
  /// views consult this to skip real AVCaptureSession setup so Canvas
  /// renders a placeholder instead of crashing on the missing camera
  /// hardware. There's no user-facing surface for this flag — it never
  /// returns true in a shipped build.
  static var isRunningInXcodePreview: Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
  }
}
