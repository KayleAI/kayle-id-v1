import CoreVideo
import XCTest
@testable import KayleIDModels

final class LivenessNonceStampTests: XCTestCase {
  private func makeBuffer() -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      LivenessNonceStamp.expectedWidth,
      LivenessNonceStamp.expectedHeight,
      kCVPixelFormatType_32BGRA,
      [
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary
      ] as CFDictionary,
      &buffer
    )
    XCTAssertEqual(status, kCVReturnSuccess)
    let pixelBuffer = buffer!
    fill(pixelBuffer: pixelBuffer, byte: 0x80)
    return pixelBuffer
  }

  private func fill(pixelBuffer: CVPixelBuffer, byte: UInt8) {
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
    let base = CVPixelBufferGetBaseAddress(pixelBuffer)!
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    memset(base, Int32(byte), bytesPerRow * height)
  }

  private func decode(from pixelBuffer: CVPixelBuffer) -> Data {
    CVPixelBufferLockBaseAddress(pixelBuffer, [.readOnly])
    defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, [.readOnly]) }
    let base = CVPixelBufferGetBaseAddress(pixelBuffer)!
    let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
    let ptr = base.assumingMemoryBound(to: UInt8.self)

    let pitch = LivenessNonceStamp.squareSize + LivenessNonceStamp.gutter
    var out = Data(count: LivenessNonceStamp.nonceByteCount)
    for bit in 0..<(LivenessNonceStamp.nonceByteCount * 8) {
      let col = bit % LivenessNonceStamp.columns
      let row = bit / LivenessNonceStamp.columns
      let x = LivenessNonceStamp.patchOriginX + col * pitch
        + LivenessNonceStamp.squareSize / 2
      let y = LivenessNonceStamp.patchOriginY + row * pitch
        + LivenessNonceStamp.squareSize / 2
      let blue = ptr[y * bytesPerRow + x * 4]
      if blue > 127 {
        let byteIndex = bit / 8
        let bitInByte = 7 - (bit % 8)
        out[byteIndex] |= UInt8(1 << bitInByte)
      }
    }
    return out
  }

  func testStampRoundTripArbitrary() throws {
    let nonce = Data([0xA5, 0x3C, 0xF0, 0x07])
    let buffer = makeBuffer()
    try LivenessNonceStamp.stamp(into: buffer, nonce: nonce)
    XCTAssertEqual(decode(from: buffer), nonce)
  }

  func testStampRoundTripZeros() throws {
    let nonce = Data(count: 4)
    let buffer = makeBuffer()
    try LivenessNonceStamp.stamp(into: buffer, nonce: nonce)
    XCTAssertEqual(decode(from: buffer), nonce)
  }

  func testStampRoundTripOnes() throws {
    let nonce = Data([0xFF, 0xFF, 0xFF, 0xFF])
    let buffer = makeBuffer()
    try LivenessNonceStamp.stamp(into: buffer, nonce: nonce)
    XCTAssertEqual(decode(from: buffer), nonce)
  }

  func testStampIsIdempotent() throws {
    let nonce = Data([0x12, 0x34, 0x56, 0x78])
    let buffer = makeBuffer()
    try LivenessNonceStamp.stamp(into: buffer, nonce: nonce)
    let firstPass = decode(from: buffer)
    try LivenessNonceStamp.stamp(into: buffer, nonce: nonce)
    XCTAssertEqual(decode(from: buffer), firstPass)
  }

  func testStampRejectsWrongLengthNonce() {
    let buffer = makeBuffer()
    XCTAssertThrowsError(
      try LivenessNonceStamp.stamp(into: buffer, nonce: Data([0x01, 0x02]))
    ) { error in
      XCTAssertEqual(
        error as? LivenessNonceStamp.StampError,
        .nonceWrongLength
      )
    }
  }

  func testStampRejectsWrongFrameSize() throws {
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferCreate(
      kCFAllocatorDefault,
      640,
      480,
      kCVPixelFormatType_32BGRA,
      [
        kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary
      ] as CFDictionary,
      &buffer
    )
    XCTAssertEqual(status, kCVReturnSuccess)
    XCTAssertThrowsError(
      try LivenessNonceStamp.stamp(
        into: buffer!,
        nonce: Data([0x01, 0x02, 0x03, 0x04])
      )
    ) { error in
      XCTAssertEqual(
        error as? LivenessNonceStamp.StampError,
        .unsupportedFrameSize
      )
    }
  }
}
