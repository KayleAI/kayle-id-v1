import XCTest
@testable import KayleIDModels

final class QRCodePayloadTests: XCTestCase {
  private static let validSessionId = "vs_" + String(repeating: "a", count: 64)
  private static let validMobileWriteToken = String(repeating: "c", count: 64)
  private static let validCancelToken = String(repeating: "d", count: 48)

  private func makeJSON(
    v: Int = 1,
    sessionId: String? = nil,
    mobileWriteToken: String? = nil,
    expiresAt: String = "2099-01-01T00:00:00Z",
    extra: String = ""
  ) -> String {
    let sessionId = sessionId ?? Self.validSessionId
    let mobileWriteToken = mobileWriteToken ?? Self.validMobileWriteToken

    return """
    {"v":\(v),"session_id":"\(sessionId)","mobile_write_token":"\(mobileWriteToken)","expires_at":"\(expiresAt)"\(extra)}
    """
  }

  func testParseRawJSONStringPayload() throws {
    let qr = "kayle-id://\(makeJSON())"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.sessionId, Self.validSessionId)
    XCTAssertEqual(parsed.mobileWriteToken, Self.validMobileWriteToken)
    XCTAssertTrue(parsed.isValid)
  }

  func testParsePercentEncodedPayload() throws {
    let encoded = makeJSON()
      .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
    XCTAssertNotNil(encoded)

    let qr = "kayle-id://\(encoded ?? "")"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.sessionId, Self.validSessionId)
    XCTAssertTrue(parsed.isValid)
  }

  func testParseSingleColonSchemePayload() throws {
    let encoded = makeJSON(expiresAt: "2099-01-01T00:00:00.000Z")
      .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
    XCTAssertNotNil(encoded)

    let qr = "kayle-id:\(encoded ?? "")"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.sessionId, Self.validSessionId)
    XCTAssertTrue(parsed.isValid)
  }

  func testLegacyGenericSchemeIsRejected() {
    let qr = "kayle://\(makeJSON())"

    XCTAssertThrowsError(try QRCodePayload.parse(from: qr))
  }

  func testOversizedPayloadIsRejectedBeforeDecoding() {
    let qr = "kayle-id://\(String(repeating: "a", count: 4097))"

    XCTAssertThrowsError(try QRCodePayload.parse(from: qr))
  }

  func testParseFractionalSecondExpiryPayload() throws {
    let qr = "kayle-id://\(makeJSON(expiresAt: "2099-01-01T00:00:00.000Z"))"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.sessionId, Self.validSessionId)
    XCTAssertTrue(parsed.isValid)
  }

  func testMissingSessionIdIsInvalid() {
    let missingSessionJSON =
      """
      {"v":1,"mobile_write_token":"\(Self.validMobileWriteToken)","expires_at":"2099-01-01T00:00:00Z"}
      """

    let qr = "kayle-id://\(missingSessionJSON)"

    XCTAssertThrowsError(try QRCodePayload.parse(from: qr))
  }

  func testExpiredPayloadIsInvalid() throws {
    let expiredJSON = makeJSON(expiresAt: "2000-01-01T00:00:00Z")
    let qr = "kayle-id://\(expiredJSON)"

    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertFalse(parsed.isValid)
  }

  func testUnknownFieldsAreIgnored() throws {
    let qr = "kayle-id://\(makeJSON(extra: ",\"extra\":\"ignored\""))"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.sessionId, Self.validSessionId)
    XCTAssertTrue(parsed.isValid)
  }

  func testValidPayloadAcceptsCancelToken() throws {
    let qr = "kayle-id://\(makeJSON(extra: ",\"cancel_token\":\"\(Self.validCancelToken)\""))"
    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertEqual(parsed.cancelToken, Self.validCancelToken)
    XCTAssertTrue(parsed.isValid)
  }

  func testUnsupportedVersionIsInvalid() throws {
    let qr = "kayle-id://\(makeJSON(v: 2))"

    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertFalse(parsed.isValid)
  }

  func testMalformedSessionIdIsInvalid() throws {
    let qr = "kayle-id://\(makeJSON(sessionId: "vs_../../session"))"

    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertFalse(parsed.isValid)
  }

  func testMalformedMobileWriteTokenIsInvalid() throws {
    let qr = "kayle-id://\(makeJSON(mobileWriteToken: "token_123"))"

    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertFalse(parsed.isValid)
  }

  func testMalformedCancelTokenIsInvalid() throws {
    let qr = "kayle-id://\(makeJSON(extra: ",\"cancel_token\":\"ct_cancel_token\""))"

    let parsed = try QRCodePayload.parse(from: qr)

    XCTAssertFalse(parsed.isValid)
  }
}
