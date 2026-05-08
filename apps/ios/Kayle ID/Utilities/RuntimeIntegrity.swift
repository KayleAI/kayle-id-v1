import Darwin
import Foundation

/// Soft-signal runtime integrity checks. Fed into `ClientHello.runtimeIntegritySignal`
/// as a bitfield; the server adds bits to `riskScore` but never gates on them
/// — App Attest carries the load-bearing claim. Cat-and-mouse, by design.
enum RuntimeIntegrity {
  enum Signal: UInt32 {
    case debuggerAttached = 0x0000_0001
    case appAttestSwizzled = 0x0000_0002
  }

  static func currentSignal() -> UInt32 {
    var bits: UInt32 = 0
    if isDebuggerAttached() {
      bits |= Signal.debuggerAttached.rawValue
    }
    if isAppAttestServiceSwizzled() {
      bits |= Signal.appAttestSwizzled.rawValue
    }
    return bits
  }

  /// Reads the kernel-reported P_TRACED flag for our own process. Returns true
  /// if a debugger (Xcode, lldb, etc.) is attached. False under TestFlight /
  /// App Store. Anti-jailbreak frameworks routinely strip P_TRACED on rooted
  /// devices — that's why this is a soft signal, not a gate.
  private static func isDebuggerAttached() -> Bool {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]

    let status = mib.withUnsafeMutableBufferPointer { buffer -> Int32 in
      sysctl(buffer.baseAddress, u_int(buffer.count), &info, &size, nil, 0)
    }

    if status != 0 {
      return false
    }
    return (info.kp_proc.p_flag & P_TRACED) != 0
  }

  /// Heuristic check for runtime swizzling of `DCAppAttestService`. Captures
  /// the IMP of `generateAssertion(_:clientDataHash:completionHandler:)` at
  /// first call and compares on subsequent calls; a mismatch suggests
  /// method_setImplementation was invoked. False positives are possible on
  /// minor iOS updates where Apple itself rebinds the IMP — accept that, the
  /// server treats the bit as risk-only.
  private static let baselineAssertionImp: IMP? = {
    guard let cls = NSClassFromString("DCAppAttestService") else {
      return nil
    }
    let selector = NSSelectorFromString(
      "generateAssertion:clientDataHash:completionHandler:"
    )
    return class_getMethodImplementation(cls, selector)
  }()

  private static func isAppAttestServiceSwizzled() -> Bool {
    guard
      let baseline = baselineAssertionImp,
      let cls = NSClassFromString("DCAppAttestService")
    else {
      return false
    }
    let selector = NSSelectorFromString(
      "generateAssertion:clientDataHash:completionHandler:"
    )
    let current = class_getMethodImplementation(cls, selector)
    return current != baseline
  }
}
