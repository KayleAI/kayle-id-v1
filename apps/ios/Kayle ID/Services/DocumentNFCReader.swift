import Combine
import Foundation
import MRTDReader
import UIKit

struct DocumentReadResult: Equatable {
  let mrz: String
  let dg1MRZ: String?
  let dataGroups: [DocumentDataGroup]
  let documentImage: UIImage?
  let signatureImage: UIImage?

  let firstName: String
  let lastName: String
  let documentNumber: String
  let nationality: String
  let dateOfBirth: String
  let gender: String
  let expiryDate: String
  let issuingAuthority: String
  let documentType: String

  // Active Authentication (ICAO 9303 Part 11 §6.1) — populated when the chip
  // exposes DG15 and MRTDReader successfully ran the challenge/response.
  let activeAuthChallenge: Data?
  let activeAuthSignature: Data?

  // Chip Authentication (TR-03110-2 §3.4) — populated when MRTDReader runs
  // CA-v2 against the chip and returns the transcript needed for server-side
  // T_PICC verification. Wire layout matches packages/api ChipAuthTranscript.
  let chipAuthTranscript: Data?

  static func == (lhs: DocumentReadResult, rhs: DocumentReadResult) -> Bool {
    lhs.mrz == rhs.mrz &&
    lhs.documentNumber == rhs.documentNumber &&
    lhs.firstName == rhs.firstName &&
    lhs.lastName == rhs.lastName
  }

  func toUploadData() throws -> Data {
    var dict: [String: Any] = [:]

    if let dg1 = dataGroups.first(where: { $0.id == 0x61 }) {
      dict["dg1"] = ["raw": dg1.data.base64EncodedString()]
    }

    if let dg2 = dataGroups.first(where: { $0.id == 0x75 }) {
      var dg2Dict: [String: Any] = ["raw": dg2.data.base64EncodedString()]
      if let image = documentImage, let jpeg = image.jpegData(compressionQuality: 0.8) {
        dg2Dict["faceImage"] = jpeg.base64EncodedString()
      }
      dict["dg2"] = dg2Dict
    }

    if let sod = dataGroups.first(where: { $0.name.contains("SOD") }) {
      dict["sod"] = ["raw": sod.data.base64EncodedString()]
    }

    if let dg14 = dataGroups.first(where: { $0.id == 0x6E }) {
      dict["dg14"] = ["raw": dg14.data.base64EncodedString()]
    }

    if let dg15 = dataGroups.first(where: { $0.id == 0x6F }) {
      dict["dg15"] = ["raw": dg15.data.base64EncodedString()]
    }

    if let challenge = activeAuthChallenge, let signature = activeAuthSignature {
      dict["activeAuth"] = [
        "challenge": challenge.base64EncodedString(),
        "signature": signature.base64EncodedString(),
      ]
    }

    if let chipAuthTranscript {
      dict["chipAuth"] = ["transcript": chipAuthTranscript.base64EncodedString()]
    }

    return try JSONSerialization.data(withJSONObject: dict)
  }
}

struct DocumentDataGroup: Identifiable, Equatable {
  let id: Int
  let name: String
  let data: Data
}

@MainActor
final class DocumentNFCReader: NSObject, ObservableObject {
  @Published var status: String = String(localized: "Idle")
  @Published var progress: Int = 0
  @Published var result: DocumentReadResult?
  @Published var errorMessage: String?

  private let reader = PassportReader()
  private var currentMRZ: String = ""
  private var currentMRZKey: String = ""
  private var currentCardAccessNumber: String?
  private var currentActiveAuthChallenge: [UInt8]?
  private var readTask: Task<Void, Never>?

  nonisolated override init() {
    super.init()
  }

  func setupDelegate() {
    reader.trackingDelegate = self
  }

  func stop() {
    readTask?.cancel()
    readTask = nil
    currentMRZ = ""
    currentMRZKey = ""
    currentCardAccessNumber = nil
    currentActiveAuthChallenge = nil
    result = nil
    errorMessage = nil
    progress = 0
    status = "Idle"
  }

  /// `activeAuthChallenge` is an optional server-issued nonce. When provided
  /// the chip is asked to sign exactly these bytes during Active
  /// Authentication, blocking the Challenge Semantics replay where a
  /// compromised client could pick the challenge.
  func start(
    mrzKey: String,
    cardAccessNumber: String? = nil,
    activeAuthChallenge: Data? = nil
  ) {
    stop()
    status = String(localized: "Initializing NFC reader...")

    setupDelegate()

    currentMRZ = mrzKey
    currentMRZKey = mrzKey
    currentCardAccessNumber = cardAccessNumber
    currentActiveAuthChallenge = activeAuthChallenge.map { Array($0) }

    guard mrzKey.count >= 20 else {
      errorMessage = String(
        localized: "Invalid MRZ key format. Please scan your document again."
      )
      status = String(localized: "Scan not valid.")
      return
    }

    readTask?.cancel()

    status = String(
      localized:
        "Press your document against your device and hold still to read the chip."
    )

    readTask = Task { [weak self] in
      await self?.readDocument()
    }
  }

  func start(
    mrz: String,
    cardAccessNumber: String? = nil,
    activeAuthChallenge: Data? = nil
  ) {
    do {
      let mrzKey = try buildMRZKey(from: mrz)
      start(
        mrzKey: mrzKey,
        cardAccessNumber: cardAccessNumber,
        activeAuthChallenge: activeAuthChallenge
      )
    } catch {
      result = nil
      errorMessage = String(
        localized: "We couldn't use this scan to read the chip. Try scanning again."
      )
      status = String(localized: "Scan not valid.")
    }
  }

  private func readDocument() async {
    do {
      let config = PassportReadingConfiguration(
        mrzKey: currentMRZKey,
        cardAccessNumber: currentCardAccessNumber,
        dataGroups: [.DG1, .DG2, .DG14, .DG15, .SOD],
        aaChallenge: currentActiveAuthChallenge,
        displayMessageHandler: { [weak self] message in
          self?.handleDisplayMessage(message)
          // Return a localized message so iOS's NFC system dialog flips to
          // the user's language; returning nil falls back to MRTDReader's
          // built-in English copy.
          return Self.localizedNFCDialogMessage(for: message)
        }
      )
      let model = try await reader.read(configuration: config)

      let result = buildResult(from: model)
      guard !Task.isCancelled else { return }
      self.result = result
      self.progress = 4
      self.status = String(localized: "Document read complete.")
    } catch is CancellationError {
      return
    } catch {
      guard !Task.isCancelled else { return }
      self.errorMessage = error.localizedDescription
      self.status = String(localized: "NFC read failed.")
    }
  }

  private static func localizedNFCDialogMessage(
    for message: NFCViewDisplayMessage
  ) -> String? {
    switch message {
    case .requestPresentPassport:
      return String(localized: "Hold your iPhone near your document.")
    case .authenticatingWithPassport:
      return String(localized: "Authenticating with document…")
    case .readingDataGroupProgress:
      return String(localized: "Reading data groups…")
    case .activeAuthentication:
      return String(localized: "Authenticating data…")
    case .successfulRead:
      return String(localized: "Document read complete.")
    case .error:
      // Let MRTDReader format error messages — they include
      // already-localized OS errors and detailed diagnostic copy that
      // would be brittle to mirror manually.
      return nil
    }
  }

  private func handleDisplayMessage(_ message: NFCViewDisplayMessage) {
    // This callback is called from a background thread, so we need to dispatch to main
    Task { @MainActor in
      switch message {
      case .requestPresentPassport:
        self.progress = 0
        self.status = String(localized: "Hold your iPhone near your document.")
      case .authenticatingWithPassport:
        self.progress = 2
        self.status = String(localized: "Authenticating with document…")
      case .readingDataGroupProgress:
        self.progress = 3
        self.status = String(localized: "Reading data groups…")
      case .activeAuthentication:
        self.progress = 3
        self.status = String(localized: "Authenticating data…")
      case .successfulRead:
        self.progress = 4
        self.status = String(localized: "Document read complete.")
      case .error(let error):
        self.status = error.localizedDescription
      }
    }
  }

  private func buildResult(from model: MRTDModel) -> DocumentReadResult {
    let dg1MRZ = model.passportMRZ == "NOT FOUND" ? nil : model.passportMRZ

    let groups = model.dataGroupsRead
      .sorted { $0.key.rawValue < $1.key.rawValue }
      .compactMap { entry -> DocumentDataGroup? in
        let data = Data(entry.value.data)
        return DocumentDataGroup(
          id: entry.key.rawValue,
          name: entry.key.getName(),
          data: data
        )
      }

    let aaChallenge = model.activeAuthenticationChallenge.isEmpty
      ? nil
      : Data(model.activeAuthenticationChallenge)
    let aaSignature = model.activeAuthenticationSignature.isEmpty
      ? nil
      : Data(model.activeAuthenticationSignature)

    let caTranscript = extractChipAuthTranscript(from: model)

    return DocumentReadResult(
      mrz: currentMRZ,
      dg1MRZ: dg1MRZ,
      dataGroups: groups,
      documentImage: model.passportImage,
      signatureImage: model.signatureImage,
      firstName: model.firstName,
      lastName: model.lastName,
      documentNumber: model.documentNumber,
      nationality: model.nationality,
      dateOfBirth: model.dateOfBirth,
      gender: model.gender,
      expiryDate: model.documentExpiryDate,
      issuingAuthority: model.issuingAuthority,
      documentType: model.documentType,
      activeAuthChallenge: aaChallenge,
      activeAuthSignature: aaSignature,
      chipAuthTranscript: caTranscript
    )
  }

  /// Serializes the MRTDReader-captured CA-v2 transcript into the wire layout
  /// the backend expects (`apps/api/src/v1/verify/chip-auth-transcript.ts`).
  /// Returns nil when the chip didn't perform CA-v2 (CA-v1, DESede, or no CA).
  private func extractChipAuthTranscript(from model: MRTDModel) -> Data? {
    guard let transcript = model.chipAuthenticationTranscript else { return nil }
    return Self.encodeChipAuthTranscript(transcript)
  }

  static func encodeChipAuthTranscript(_ transcript: ChipAuthenticationTranscript) -> Data? {
    guard let oidBytes = transcript.oid.data(using: .utf8) else { return nil }

    let keyIdBytes = transcript.keyId.map { encodeUnsignedBigEndian(Int($0)) } ?? Data()
    guard keyIdBytes.count <= 0xFF else { return nil }

    let sk = transcript.terminalPrivateKey
    let pk = transcript.terminalPublicKey
    let nonce = transcript.chipNonce
    let token = transcript.chipToken

    guard oidBytes.count <= 0xFFFF,
          sk.count <= 0xFFFF,
          pk.count <= 0xFFFF,
          nonce.count <= 0xFF,
          token.count <= 0xFF else {
      return nil
    }

    var out = Data()
    out.append(0x01)  // version
    appendUInt16BE(&out, oidBytes.count)
    out.append(oidBytes)
    out.append(UInt8(keyIdBytes.count))
    out.append(keyIdBytes)
    appendUInt16BE(&out, sk.count)
    out.append(contentsOf: sk)
    appendUInt16BE(&out, pk.count)
    out.append(contentsOf: pk)
    out.append(UInt8(nonce.count))
    out.append(contentsOf: nonce)
    out.append(UInt8(token.count))
    out.append(contentsOf: token)
    return out
  }

  private static func appendUInt16BE(_ data: inout Data, _ value: Int) {
    data.append(UInt8((value >> 8) & 0xFF))
    data.append(UInt8(value & 0xFF))
  }

  private static func encodeUnsignedBigEndian(_ value: Int) -> Data {
    if value == 0 { return Data() }
    var v = value
    var bytes = [UInt8]()
    while v > 0 {
      bytes.insert(UInt8(v & 0xFF), at: 0)
      v >>= 8
    }
    return Data(bytes)
  }

  private func buildMRZKey(from mrz: String) throws -> String {
    let result = try MRZParser.parseAndValidate(mrz)
    return result.mrzKey
  }

}

@available(iOS 15, *)
extension DocumentNFCReader: MRTDReaderTrackingDelegate {
  nonisolated func nfcTagDetected() {
    Task { @MainActor in
      self.progress = 1
      self.status = String(localized: "Document detected.")
    }
  }

  nonisolated func readCardAccess(cardAccess: CardAccess) {
    Task { @MainActor in
      self.status = String(localized: "Reading Card Access…")
    }
  }

  nonisolated func paceStarted() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "Performing PACE authentication…")
    }
  }

  nonisolated func paceSucceeded() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "PACE succeeded.")
    }
  }

  nonisolated func paceFailed() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "PACE failed, falling back to BAC…")
    }
  }

  nonisolated func bacStarted() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "Performing BAC authentication…")
    }
  }

  nonisolated func bacSucceeded() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "BAC succeeded.")
    }
  }

  nonisolated func bacFailed() {
    Task { @MainActor in
      self.progress = 2
      self.status = String(localized: "BAC failed.")
    }
  }
}
