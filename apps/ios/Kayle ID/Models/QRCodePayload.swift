import Foundation

private let qrCodePayloadISO8601WithFractionalSecondsFormatter = {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [
    .withInternetDateTime,
    .withFractionalSeconds,
  ]
  return formatter
}()

private let qrCodePayloadISO8601Formatter = ISO8601DateFormatter()

func parseQRCodePayloadDate(_ value: String) -> Date? {
  qrCodePayloadISO8601WithFractionalSecondsFormatter.date(from: value) ??
    qrCodePayloadISO8601Formatter.date(from: value)
}

/// QR code payload parsed from the `kayle-id://` URL scheme.
struct QRCodePayload: Codable {
  private static let supportedSchemePrefixes = [
    "kayle-id://",
    "kayle-id:",
  ]
  private static let currentPayloadVersion = 1
  private static let generatedIdRandomLength = 64
  private static let mobileWriteTokenLength = 64
  private static let cancelTokenLength = 48
  private static let maxPayloadUrlLength = 4096

  let v: Int?
  let sessionId: String
  let attemptId: String
  let mobileWriteToken: String
  let expiresAt: Date
  let cancelToken: String?
  /// Base64url-encoded server-derived challenge for the App Attest hello
  /// assertion. Populated by `POST /v1/verify/session/:id/handoff` once the
  /// server adds the field; older handoff responses or QR codes that pre-date
  /// the App Attest gate may omit it.
  let attestHelloChallenge: String?
  /// Base64url-encoded server-derived challenge for the App Attest NFC
  /// payload assertion. Same lifecycle as `attestHelloChallenge`; both are
  /// HMAC-derived from `attemptId + AUTH_SECRET` and survive reconnects.
  let attestNfcChallenge: String?

  enum CodingKeys: String, CodingKey {
    case v
    case sessionId = "session_id"
    case attemptId = "attempt_id"
    case mobileWriteToken = "mobile_write_token"
    case expiresAt = "expires_at"
    case cancelToken = "cancel_token"
    case attestHelloChallenge = "attest_hello_challenge"
    case attestNfcChallenge = "attest_nfc_challenge"
  }

  init(
    v: Int?,
    sessionId: String,
    attemptId: String,
    mobileWriteToken: String,
    expiresAt: Date,
    cancelToken: String? = nil,
    attestHelloChallenge: String? = nil,
    attestNfcChallenge: String? = nil
  ) {
    self.v = v
    self.sessionId = sessionId
    self.attemptId = attemptId
    self.mobileWriteToken = mobileWriteToken
    self.expiresAt = expiresAt
    self.cancelToken = cancelToken
    self.attestHelloChallenge = attestHelloChallenge
    self.attestNfcChallenge = attestNfcChallenge
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    v = try container.decodeIfPresent(Int.self, forKey: .v)
    sessionId = try container.decode(String.self, forKey: .sessionId)
    attemptId = try container.decode(String.self, forKey: .attemptId)
    mobileWriteToken = try container.decode(String.self, forKey: .mobileWriteToken)
    cancelToken = try container.decodeIfPresent(String.self, forKey: .cancelToken)
    attestHelloChallenge = try container.decodeIfPresent(
      String.self,
      forKey: .attestHelloChallenge
    )
    attestNfcChallenge = try container.decodeIfPresent(
      String.self,
      forKey: .attestNfcChallenge
    )
    let expiresAtValue = try container.decode(String.self, forKey: .expiresAt)

    guard let parsedExpiresAt = parseQRCodePayloadDate(expiresAtValue) else {
      throw DecodingError.dataCorruptedError(
        forKey: .expiresAt,
        in: container,
        debugDescription: "expires_at must be a valid ISO-8601 timestamp."
      )
    }

    expiresAt = parsedExpiresAt
  }

  /// Parse a QR code payload from a `kayle-id://` URL.
  static func parse(from urlString: String) throws -> QRCodePayload {
    guard urlString.count <= maxPayloadUrlLength else {
      throw QRCodePayloadError.invalidPayload
    }

    guard
      let prefix = supportedSchemePrefixes.first(where: { urlString.hasPrefix($0) })
    else {
      throw QRCodePayloadError.invalidScheme
    }

    let payloadString = String(urlString.dropFirst(prefix.count))
      .trimmingCharacters(in: .whitespacesAndNewlines)

    let normalizedPayload: String
    if payloadString.hasPrefix("/") {
      normalizedPayload = String(payloadString.dropFirst())
    } else {
      normalizedPayload = payloadString
    }

    let jsonString = normalizedPayload.removingPercentEncoding ?? normalizedPayload

    guard let data = jsonString.data(using: .utf8) else {
      throw QRCodePayloadError.invalidEncoding
    }

    do {
      return try JSONDecoder().decode(QRCodePayload.self, from: data)
    } catch {
      throw QRCodePayloadError.decodingFailed(error)
    }
  }

  /// Validate that the payload includes required fields.
  var isValid: Bool {
    let expirySkewToleranceSeconds = 30.0

    return isSupportedVersion &&
      Self.isGeneratedId(sessionId, prefix: "vs_") &&
      Self.isGeneratedId(attemptId, prefix: "va_") &&
      Self.isLowercaseHex(mobileWriteToken, length: Self.mobileWriteTokenLength) &&
      Self.isValidCancelToken(cancelToken) &&
      expiresAt.timeIntervalSinceNow >= -expirySkewToleranceSeconds
  }

  private var isSupportedVersion: Bool {
    guard let v else {
      return true
    }
    return v == Self.currentPayloadVersion
  }

  private static func isGeneratedId(_ value: String, prefix: String) -> Bool {
    guard value.hasPrefix(prefix) else {
      return false
    }

    let suffix = value.dropFirst(prefix.count)
    guard suffix.count == generatedIdRandomLength else {
      return false
    }

    return suffix.utf8.allSatisfy { byte in
      (byte >= CharacterByte.zero && byte <= CharacterByte.nine) ||
        (byte >= CharacterByte.uppercaseA && byte <= CharacterByte.uppercaseZ) ||
        (byte >= CharacterByte.lowercaseA && byte <= CharacterByte.lowercaseZ)
    }
  }

  private static func isLowercaseHex(_ value: String, length: Int) -> Bool {
    guard value.count == length else {
      return false
    }

    return value.utf8.allSatisfy { byte in
      (byte >= CharacterByte.zero && byte <= CharacterByte.nine) ||
        (byte >= CharacterByte.lowercaseA && byte <= CharacterByte.lowercaseF)
    }
  }

  private static func isValidCancelToken(_ value: String?) -> Bool {
    guard let value else {
      return true
    }

    guard value.count == cancelTokenLength else {
      return false
    }

    return value.utf8.allSatisfy { byte in
      (byte >= CharacterByte.zero && byte <= CharacterByte.nine) ||
        (byte >= CharacterByte.uppercaseA && byte <= CharacterByte.uppercaseZ) ||
        (byte >= CharacterByte.lowercaseA && byte <= CharacterByte.lowercaseZ)
    }
  }
}

private enum CharacterByte {
  static let zero = UInt8(ascii: "0")
  static let nine = UInt8(ascii: "9")
  static let uppercaseA = UInt8(ascii: "A")
  static let uppercaseZ = UInt8(ascii: "Z")
  static let lowercaseA = UInt8(ascii: "a")
  static let lowercaseF = UInt8(ascii: "f")
  static let lowercaseZ = UInt8(ascii: "z")
}

enum QRCodePayloadError: LocalizedError {
  case invalidScheme
  case invalidEncoding
  case decodingFailed(Error)
  case invalidPayload

  var errorDescription: String? {
    switch self {
    case .invalidScheme:
      return "Invalid QR code format. Expected kayle-id:// URL."
    case .invalidEncoding:
      return "Could not decode QR code data."
    case .decodingFailed(let error):
      return "Failed to parse QR code: \(error.localizedDescription)"
    case .invalidPayload:
      return "Invalid QR code payload."
    }
  }
}
