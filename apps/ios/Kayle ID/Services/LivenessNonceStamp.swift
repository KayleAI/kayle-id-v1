import CoreVideo
import Foundation

// Layout MUST match `apps/biometric-verifier/src/service.py`
// (`NONCE_PATCH_X` etc.). 32 squares = 32 bits = 4 bytes, stamped at
// the bottom-left of every recorded frame below the user's chin so
// neither YuNet nor the 478-pt face mesh latches onto the grid.
enum LivenessNonceStamp {
  static let patchOriginX = 16
  static let patchOriginY = 1120
  static let columns = 8
  static let rows = 4
  static let squareSize = 24
  static let gutter = 8
  static let nonceByteCount = 4
  static let expectedWidth = 720
  static let expectedHeight = 1280

  enum StampError: Error {
    case nonceWrongLength
    case unsupportedPixelFormat
    case unsupportedFrameSize
    case lockFailed
  }

  /// Stamp the 4-byte nonce as a 32-cell black/white grid into the
  /// BGRA pixel buffer. Idempotent — re-stamping with the same nonce
  /// is a no-op at the pixel level.
  static func stamp(into pixelBuffer: CVPixelBuffer, nonce: Data) throws {
    guard nonce.count == nonceByteCount else {
      throw StampError.nonceWrongLength
    }
    let pixelFormat = CVPixelBufferGetPixelFormatType(pixelBuffer)
    guard pixelFormat == kCVPixelFormatType_32BGRA else {
      throw StampError.unsupportedPixelFormat
    }
    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    guard width == expectedWidth, height == expectedHeight else {
      throw StampError.unsupportedFrameSize
    }
    let lockResult = CVPixelBufferLockBaseAddress(pixelBuffer, [])
    guard lockResult == kCVReturnSuccess else {
      throw StampError.lockFailed
    }
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }

    guard let base = CVPixelBufferGetBaseAddress(pixelBuffer) else {
      throw StampError.lockFailed
    }
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let pitch = squareSize + gutter
    let bytePtr = base.assumingMemoryBound(to: UInt8.self)

    for bitIndex in 0..<(nonceByteCount * 8) {
      let byteIndex = bitIndex / 8
      let bitInByte = 7 - (bitIndex % 8)
      let bit = (nonce[byteIndex] >> bitInByte) & 1
      let value: UInt8 = bit == 1 ? 255 : 0
      let col = bitIndex % columns
      let row = bitIndex / columns
      let x0 = patchOriginX + col * pitch
      let y0 = patchOriginY + row * pitch

      for dy in 0..<squareSize {
        let rowOffset = (y0 + dy) * bytesPerRow + x0 * 4
        for dx in 0..<squareSize {
          let offset = rowOffset + dx * 4
          // BGRA: write B, G, R; leave alpha alone.
          bytePtr[offset] = value
          bytePtr[offset + 1] = value
          bytePtr[offset + 2] = value
        }
      }
    }
  }
}
