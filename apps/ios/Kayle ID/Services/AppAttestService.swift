import CryptoKit
import DeviceCheck
import Foundation
import Security

/// App Attest is iOS-only and requires a real device + Apple-signed build. The
/// simulator returns `DCAppAttestService.isSupported == false`.
///
/// Key lifecycle (mirrors what the server expects in
/// `apps/api/src/v1/verify/app-attest.ts`):
///
///   1. `register()` calls `DCAppAttestService.shared.generateKey()` and stores
///      the returned keyId in Keychain. It then fetches a server challenge,
///      hashes it into a `clientDataHash`, calls `attestKey`, and POSTs the
///      resulting attestation CBOR + challenge to
///      `POST /v1/verify/attest/register`.
///   2. `helloAssertion(...)` builds the canonical hello clientDataHash from
///      `attemptId / deviceId / appVersion / handoffChallenge` and signs it.
///   3. `nfcPayloadAssertion(...)` builds the NFC clientDataHash from the
///      attempt id and SHA-256 of every NFC artifact (in the same canonical
///      order as `attest-gate.ts buildNfcClientDataHash`) and signs it.
///
/// `DCError.invalidKey` is the recoverable failure path: Apple has rejected
/// the key (server flagged it as fraudulent or it expired). We delete the
/// Keychain entry and call `register()` once before retrying.
@MainActor
final class AppAttestService {
  enum AppAttestError: LocalizedError {
    case unsupported
    case keyGenerationFailed(Error)
    case attestationFailed(Error)
    case assertionFailed(Error)
    case challengeRequestFailed(Error)
    case challengeRequestRejected(statusCode: Int)
    case registerRejected(code: String?)
    case keychainFailed(OSStatus)
    case invalidServerResponse

    var errorDescription: String? {
      switch self {
      case .unsupported:
        return "This device cannot complete verification. Please use an iPhone running iOS 16 or later."
      case .keyGenerationFailed(let error),
        .attestationFailed(let error),
        .assertionFailed(let error),
        .challengeRequestFailed(let error):
        return error.localizedDescription
      case .challengeRequestRejected(let statusCode):
        return "Verification setup failed (HTTP \(statusCode))."
      case .registerRejected(let code):
        return code ?? "Verification setup was rejected by the server."
      case .keychainFailed(let status):
        return "Keychain access failed (\(status))."
      case .invalidServerResponse:
        return "The server returned an unexpected response."
      }
    }
  }

  static let shared = AppAttestService()

  private let appAttest = DCAppAttestService.shared
  private let keychainService = "id.kayle.AppAttest"
  private let legacyKeychainAccount = "key-id"
  private let productionAPIHost = "api.kayle.id"
  private var cachedKeyId: String?
  private var cachedKeyIdHost: String?

  private init() {}

  /// Returns the registered keyId, registering on first call.
  func currentKeyId(baseURL: String) async throws -> String {
    let host = keychainAccountHost(for: baseURL)
    if let cached = cachedKeyId, cachedKeyIdHost == host, !cached.isEmpty {
      return cached
    }
    if let stored = readKeychainKeyId(for: baseURL), !stored.isEmpty {
      cachedKeyId = stored
      cachedKeyIdHost = host
      return stored
    }
    return try await register(baseURL: baseURL)
  }

  /// Performs a fresh App Attest registration. Generates a new SE key, fetches
  /// a server challenge, calls `attestKey`, and POSTs the attestation. On
  /// success persists the keyId in Keychain and caches in memory.
  func register(baseURL: String) async throws -> String {
    guard appAttest.isSupported else {
      throw AppAttestError.unsupported
    }

    let keyId: String
    do {
      keyId = try await appAttest.generateKey()
    } catch {
      throw AppAttestError.keyGenerationFailed(error)
    }

    let challenge = try await fetchChallenge(baseURL: baseURL)
    let clientDataHash = sha256(
      Data(base64URLEncodedString: challenge) ?? Data()
    )

    let attestation: Data
    do {
      attestation = try await appAttest.attestKey(keyId, clientDataHash: clientDataHash)
    } catch {
      // Apple invalidated the key (revoked, environment mismatch, etc.).
      // Drop the Keychain entry so the next call regenerates from scratch.
      deleteKeychainKeyId(for: baseURL)
      throw AppAttestError.attestationFailed(error)
    }

    try await sendRegister(
      baseURL: baseURL,
      keyId: keyId,
      attestation: attestation,
      challenge: challenge
    )

    try writeKeychainKeyId(keyId, for: baseURL)
    cachedKeyId = keyId
    cachedKeyIdHost = keychainAccountHost(for: baseURL)
    return keyId
  }

  /// Build clientDataHash for the hello assertion and produce the CBOR
  /// assertion bytes the WebSocket carries in `ClientHello.helloAssertion`.
  func helloAssertion(
    baseURL: String,
    attemptId: String,
    deviceId: String,
    appVersion: String,
    challenge: Data
  ) async throws -> (keyId: String, assertion: Data) {
    let keyId = try await currentKeyId(baseURL: baseURL)

    let clientData = Data("attest:hello:".utf8)
      + Data(attemptId.utf8)
      + Data(deviceId.utf8)
      + Data(appVersion.utf8)
      + challenge

    let clientDataHash = sha256(clientData)
    let assertion = try await generateAssertionWithRotation(
      baseURL: baseURL,
      keyId: keyId,
      clientDataHash: clientDataHash
    )

    return (keyId: assertion.keyId, assertion: assertion.bytes)
  }

  /// Build clientDataHash for the NFC-completion assertion. Order MUST match
  /// `apps/api/src/v1/verify/attest-gate.ts buildNfcClientDataHash` exactly.
  func nfcPayloadAssertion(
    baseURL: String,
    attemptId: String,
    challenge: Data,
    digests: NfcArtifactDigests
  ) async throws -> Data {
    let keyId = try await currentKeyId(baseURL: baseURL)

    var clientData = Data("attest:nfc:".utf8)
    clientData.append(contentsOf: Data(attemptId.utf8))
    clientData.append(digests.dg1)
    clientData.append(digests.dg2)
    clientData.append(digests.dg14)
    clientData.append(digests.dg15)
    clientData.append(digests.sod)
    clientData.append(digests.chipAuthTranscript)
    clientData.append(digests.activeAuthSignature)
    clientData.append(challenge)

    let clientDataHash = sha256(clientData)
    let assertion = try await generateAssertionWithRotation(
      baseURL: baseURL,
      keyId: keyId,
      clientDataHash: clientDataHash
    )
    return assertion.bytes
  }

  // MARK: - Internals

  private func generateAssertionWithRotation(
    baseURL: String,
    keyId: String,
    clientDataHash: Data
  ) async throws -> (keyId: String, bytes: Data) {
    do {
      let bytes = try await appAttest.generateAssertion(keyId, clientDataHash: clientDataHash)
      return (keyId: keyId, bytes: bytes)
    } catch let error as DCError where error.code == .invalidKey {
      // Server invalidated the key. Rotate exactly once.
      deleteKeychainKeyId(for: baseURL)
      cachedKeyId = nil
      cachedKeyIdHost = nil
      let freshKeyId = try await register(baseURL: baseURL)
      do {
        let bytes = try await appAttest.generateAssertion(
          freshKeyId,
          clientDataHash: clientDataHash
        )
        return (keyId: freshKeyId, bytes: bytes)
      } catch {
        throw AppAttestError.assertionFailed(error)
      }
    } catch {
      throw AppAttestError.assertionFailed(error)
    }
  }

  private func fetchChallenge(baseURL: String) async throws -> String {
    guard let url = URL(string: "\(baseURL)/v1/verify/attest/challenge") else {
      throw AppAttestError.invalidServerResponse
    }

    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await URLSession.shared.data(from: url)
    } catch {
      throw AppAttestError.challengeRequestFailed(error)
    }

    guard let http = response as? HTTPURLResponse else {
      throw AppAttestError.invalidServerResponse
    }
    guard (200...299).contains(http.statusCode) else {
      throw AppAttestError.challengeRequestRejected(statusCode: http.statusCode)
    }

    guard
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let payload = envelope["data"] as? [String: Any],
      let challenge = payload["challenge"] as? String
    else {
      throw AppAttestError.invalidServerResponse
    }

    return challenge
  }

  private func sendRegister(
    baseURL: String,
    keyId: String,
    attestation: Data,
    challenge: String
  ) async throws {
    guard let url = URL(string: "\(baseURL)/v1/verify/attest/register") else {
      throw AppAttestError.invalidServerResponse
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let body: [String: Any] = [
      "key_id": keyId,
      "attestation": attestation.base64EncodedString(),
      "challenge": challenge,
    ]
    request.httpBody = try JSONSerialization.data(withJSONObject: body)

    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await URLSession.shared.data(for: request)
    } catch {
      throw AppAttestError.challengeRequestFailed(error)
    }

    guard let http = response as? HTTPURLResponse else {
      throw AppAttestError.invalidServerResponse
    }

    if (200...299).contains(http.statusCode) {
      return
    }

    let envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    let errorCode = (envelope?["error"] as? [String: Any])?["code"] as? String
    throw AppAttestError.registerRejected(code: errorCode)
  }

  private func sha256(_ data: Data) -> Data {
    Data(SHA256.hash(data: data))
  }

  // MARK: - Keychain

  // Apple's App Attest keyId is tied to a server-side registration in a
  // specific database. Production, staging, and local-dev each have their
  // own `mobile_attest_keys` table, so sharing a single Keychain entry
  // across environments produces `HELLO_ATTEST_KEY_UNKNOWN` ("Your device
  // hasn't completed setup") as soon as you switch — the iOS side still
  // remembers a keyId the new server has never seen. Scope the account by
  // baseURL host so each environment holds its own registration.
  //
  // Production keeps the legacy `key-id` account to avoid forcing
  // App Store users through a one-time re-registration on update.
  private func keychainAccountHost(for baseURL: String) -> String {
    URLComponents(string: baseURL)?.host?.lowercased() ?? ""
  }

  private func keychainAccount(for baseURL: String) -> String {
    let host = keychainAccountHost(for: baseURL)
    if host == productionAPIHost {
      return legacyKeychainAccount
    }
    return "\(legacyKeychainAccount):\(host)"
  }

  private func keychainQuery(for baseURL: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: keychainAccount(for: baseURL),
    ]
  }

  private func readKeychainKeyId(for baseURL: String) -> String? {
    var query = keychainQuery(for: baseURL)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    guard status == errSecSuccess, let data = result as? Data else {
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  private func writeKeychainKeyId(_ keyId: String, for baseURL: String) throws {
    guard let data = keyId.data(using: .utf8) else {
      throw AppAttestError.invalidServerResponse
    }

    var query = keychainQuery(for: baseURL)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

    let updateAttributes: [String: Any] = [kSecValueData as String: data]
    let updateStatus = SecItemUpdate(
      query as CFDictionary,
      updateAttributes as CFDictionary
    )

    if updateStatus == errSecSuccess {
      return
    }

    if updateStatus == errSecItemNotFound {
      var addQuery = query
      addQuery[kSecValueData as String] = data
      let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
      if addStatus != errSecSuccess {
        throw AppAttestError.keychainFailed(addStatus)
      }
      return
    }

    throw AppAttestError.keychainFailed(updateStatus)
  }

  private func deleteKeychainKeyId(for baseURL: String) {
    SecItemDelete(keychainQuery(for: baseURL) as CFDictionary)
  }
}

/// Pre-computed SHA-256 digests of every NFC artifact that the server's
/// `buildNfcClientDataHash` consumes. Empty artifacts hash to SHA-256("") on
/// both sides — never omit a slot.
struct NfcArtifactDigests {
  let dg1: Data
  let dg2: Data
  let dg14: Data
  let dg15: Data
  let sod: Data
  let chipAuthTranscript: Data
  let activeAuthSignature: Data

  static let emptySha256 = Data(SHA256.hash(data: Data()))

  static func make(
    dg1: Data?,
    dg2: Data?,
    dg14: Data?,
    dg15: Data?,
    sod: Data?,
    chipAuthTranscript: Data?,
    activeAuthSignature: Data?
  ) -> NfcArtifactDigests {
    func digest(_ data: Data?) -> Data {
      guard let data, !data.isEmpty else {
        return emptySha256
      }
      return Data(SHA256.hash(data: data))
    }

    return NfcArtifactDigests(
      dg1: digest(dg1),
      dg2: digest(dg2),
      dg14: digest(dg14),
      dg15: digest(dg15),
      sod: digest(sod),
      chipAuthTranscript: digest(chipAuthTranscript),
      activeAuthSignature: digest(activeAuthSignature)
    )
  }
}

// MARK: - base64url

extension Data {
  init?(base64URLEncodedString input: String) {
    var s = input.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let pad = (4 - s.count % 4) % 4
    s.append(String(repeating: "=", count: pad))
    self.init(base64Encoded: s)
  }
}
