import Foundation

enum VerifyWebSocketError: LocalizedError {
  case notConnected
  case invalidURL
  case sendFailed
  case sendFailedWithReason(String)
  case connectionClosed
  case helloTimedOut
  case serverResponseTimedOut
  case serverError(code: String, message: String)
  case unexpectedServerResponse(String)
  case reconnectFailed

  var errorDescription: String? {
    switch self {
    case .notConnected:
      return "WebSocket not connected."
    case .invalidURL:
      return "Invalid WebSocket URL."
    case .sendFailed:
      return "Failed to send WebSocket message."
    case .sendFailedWithReason(let message):
      return "Failed to send WebSocket message: \(message)"
    case .connectionClosed:
      return "WebSocket connection closed unexpectedly."
    case .helloTimedOut:
      return "Timed out waiting for verification handshake."
    case .serverResponseTimedOut:
      return "Timed out waiting for verification server response."
    case .serverError(_, let message):
      return message
    case .unexpectedServerResponse(let message):
      return message
    case .reconnectFailed:
      return "Failed to reconnect verification session."
    }
  }

  var serverErrorCode: String? {
    if case .serverError(let code, _) = self {
      return code
    }
    return nil
  }

  var isNonRetryableAuthFailure: Bool {
    guard let code = serverErrorCode else {
      return false
    }
    return isNonRetryableAuthErrorCode(code)
  }
}

nonisolated private enum PublicShareFieldVisibility {
  static let showsKayleHumanId = false
}

nonisolated private func shareFieldDisplayName(_ key: String) -> String? {
  switch key {
  case "document_type_code":
    return String(localized: "Document Type Code")
  case "issuing_country_code":
    return String(localized: "Issuing Country Code")
  case "family_name":
    return String(localized: "Family Name")
  case "given_names":
    return String(localized: "Given Names")
  case "document_number":
    return String(localized: "Document Number")
  case "nationality_code":
    return String(localized: "Nationality Code")
  case "date_of_birth":
    return String(localized: "Date of Birth")
  case "sex_marker":
    return String(localized: "Sex Marker")
  case "document_expiry_date":
    return String(localized: "Expiry Date")
  case "mrz_optional_data":
    return String(localized: "MRZ Optional Data")
  case "document_photo":
    return String(localized: "Document Photo")
  case "kayle_document_id":
    return String(localized: "Kayle Document ID")
  case "kayle_human_id":
    return String(localized: "Kayle Human ID")
  default:
    return nil
  }
}

enum VerifyHelloResponse: Equatable {
  case success
  case failure(code: String, message: String)
}

enum VerifyCheckOutcome: Equatable {
  case confirmed
  case notConfirmed
}

enum VerifyCheckKind: Int32, Equatable {
  case mrz = 0
  case nfc = 1
  case liveness = 2
  case none = 3
}

struct VerifyServerCheckResult: Equatable {
  let outcome: VerifyCheckOutcome
  let reasonCode: String
  let reasonMessage: String
  let retryAllowed: Bool
  let failedCheck: VerifyCheckKind
  let remainingNfcRetries: Int
  let remainingLivenessRetries: Int
}

struct VerifyShareRequestField: Equatable, Identifiable {
  let key: String
  let reason: String
  let required: Bool

  var id: String {
    key
  }
}

struct VerifyShareRequest: Equatable {
  let contractVersion: Int
  let sessionId: String
  let fields: [VerifyShareRequestField]
}

struct VerifyShareReady: Equatable {
  let sessionId: String
  let selectedFieldKeys: [String]
}

struct VerifySharePreviewContext: Equatable {
  let birthDate: String?
  let documentNumber: String?
  let documentType: String?
  let expiryDate: String?
  let givenNames: String?
  let issuingCountry: String?
  let nationality: String?
  let optionalData: String?
  let sex: String?
  let surname: String?
}

struct VerifyChunkRetryInstruction: Equatable {
  let kind: Int
  let index: Int
  let chunkIndex: Int
  let reason: String
}

struct VerifyMissingNFCChunk: Equatable {
  let kind: Int
  let index: Int
  let chunkTotal: Int?
  let missingChunkIndices: [Int]
}

struct VerifyMissingNFCDataInstruction: Equatable {
  let missingArtifacts: [String]
  let missingChunks: [VerifyMissingNFCChunk]
}

struct VerifyMissingLivenessDataInstruction: Equatable {
  let receivedBytes: Int
  let missingChunks: [VerifyMissingNFCChunk]
}

nonisolated func isExpectedDataAck(
  ackMessage: String?,
  kind: Int,
  index: Int,
  chunkIndex: Int,
  chunkTotal: Int
) -> Bool {
  guard let ackMessage else {
    return false
  }

  if chunkTotal <= 1 {
    return ackMessage == "data_ok_\(kind)_\(index)"
  }

  let chunkAck = "data_chunk_ok_\(kind)_\(index)_\(chunkIndex)"
  let finalAck = "data_ok_\(kind)_\(index)"
  return ackMessage == chunkAck ||
    (chunkIndex == chunkTotal - 1 && ackMessage == finalAck)
}

nonisolated func isExpectedPhaseAck(_ ackMessage: String?) -> Bool {
  ackMessage == "phase_ok"
}

nonisolated func parseChunkRetryInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyChunkRetryInstruction? {
  guard errorCode == "DATA_CHUNK_RETRY", let errorMessage else {
    return nil
  }

  guard
    let data = errorMessage.data(using: .utf8),
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let kind = json["kind"] as? Int,
    let index = json["index"] as? Int,
    let chunkIndex = json["chunkIndex"] as? Int
  else {
    return nil
  }

  let reason = json["reason"] as? String ?? "unknown"
  return VerifyChunkRetryInstruction(
    kind: kind,
    index: index,
    chunkIndex: chunkIndex,
    reason: reason
  )
}

nonisolated func parseMissingNFCDataInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyMissingNFCDataInstruction? {
  guard errorCode == "NFC_REQUIRED_DATA_MISSING", let errorMessage else {
    return nil
  }

  guard
    let data = errorMessage.data(using: .utf8),
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else {
    return nil
  }

  let missingArtifacts = json["missing_artifacts"] as? [String] ?? []
  let rawChunks = json["missing_chunks"] as? [[String: Any]] ?? []
  let missingChunks: [VerifyMissingNFCChunk] = rawChunks.compactMap { chunk in
    guard
      let kind = chunk["kind"] as? Int,
      let index = chunk["index"] as? Int
    else {
      return nil
    }

    let chunkTotal = chunk["chunk_total"] as? Int
    let missingChunkIndices = chunk["missing_chunk_indices"] as? [Int] ?? []
    return VerifyMissingNFCChunk(
      kind: kind,
      index: index,
      chunkTotal: chunkTotal,
      missingChunkIndices: missingChunkIndices
    )
  }

  return VerifyMissingNFCDataInstruction(
    missingArtifacts: missingArtifacts,
    missingChunks: missingChunks
  )
}

nonisolated func parseMissingLivenessDataInstruction(
  errorCode: String?,
  errorMessage: String?
) -> VerifyMissingLivenessDataInstruction? {
  guard errorCode == "LIVENESS_REQUIRED_DATA_MISSING", let errorMessage else {
    return nil
  }

  guard
    let data = errorMessage.data(using: .utf8),
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
  else {
    return nil
  }

  let receivedBytes = json["received_bytes"] as? Int ?? 0
  let rawChunks = json["missing_chunks"] as? [[String: Any]] ?? []
  let missingChunks: [VerifyMissingNFCChunk] = rawChunks.compactMap { chunk in
    guard
      let kind = chunk["kind"] as? Int,
      let index = chunk["index"] as? Int
    else {
      return nil
    }

    let chunkTotal = chunk["chunk_total"] as? Int
    let missingChunkIndices = chunk["missing_chunk_indices"] as? [Int] ?? []
    return VerifyMissingNFCChunk(
      kind: kind,
      index: index,
      chunkTotal: chunkTotal,
      missingChunkIndices: missingChunkIndices
    )
  }

  return VerifyMissingLivenessDataInstruction(
    receivedBytes: receivedBytes,
    missingChunks: missingChunks
  )
}

nonisolated func parseHelloResponse(
  ackMessage: String?,
  errorCode: String?,
  errorMessage: String?
) -> VerifyHelloResponse? {
  if let code = errorCode, !code.isEmpty {
    return .failure(code: code, message: errorMessage ?? code)
  }

  if ackMessage == "hello_ok" {
    return .success
  }

  return nil
}

nonisolated func isConfirmedCheck(_ checkResult: VerifyServerCheckResult?) -> Bool {
  guard let checkResult else {
    return false
  }

  switch checkResult.outcome {
  case .confirmed:
    return true
  case .notConfirmed:
    return false
  }
}

nonisolated func isNotConfirmedCheck(_ checkResult: VerifyServerCheckResult?) -> Bool {
  guard let checkResult else {
    return false
  }

  switch checkResult.outcome {
  case .confirmed:
    return false
  case .notConfirmed:
    return true
  }
}

nonisolated func shouldSuppressReconnectAfterHandledCheckResult(
  _ checkResult: VerifyServerCheckResult?
) -> Bool {
  isNotConfirmedCheck(checkResult)
}

nonisolated func defaultSelectedShareFieldKeys(
  _ shareRequest: VerifyShareRequest?
) -> Set<String> {
  guard let shareRequest else {
    return []
  }

  return Set(
    shareRequest.fields.compactMap { field in
      isShareFieldSelectionLocked(field) ? field.key : nil
    }
  )
}

nonisolated func hasUnselectedOptionalShareFields(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Bool {
  optionalShareRequestFields(shareRequest).contains { field in
    !selectedShareFieldKeys.contains(field.key)
  }
}

nonisolated func selectedShareFieldKeysIncludingAllOptionalFields(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Set<String> {
  var nextSelectedShareFieldKeys = selectedShareFieldKeys

  for field in optionalShareRequestFields(shareRequest) {
    nextSelectedShareFieldKeys.insert(field.key)
  }

  return nextSelectedShareFieldKeys
}

nonisolated func orderedSelectedShareFieldKeys(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> [String] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.compactMap { field in
    selectedShareFieldKeys.contains(field.key) || isShareFieldSelectionLocked(field)
      ? field.key
      : nil
  }
}

nonisolated func isShareSelectionSubmittable(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Bool {
  guard let shareRequest else {
    return false
  }

  let requiredKeys = shareRequest.fields.compactMap { field in
    field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
      ? field.key
      : nil
  }

  return requiredKeys.allSatisfy(selectedShareFieldKeys.contains)
}

nonisolated func isShareFieldSelectionLocked(_ field: VerifyShareRequestField) -> Bool {
  field.required || isKayleShareField(field.key)
}

nonisolated func isKayleShareField(_ key: String) -> Bool {
  key.hasPrefix("kayle_")
}

nonisolated func isPubliclyVisibleShareField(_ key: String) -> Bool {
  if key == "kayle_human_id" {
    return PublicShareFieldVisibility.showsKayleHumanId
  }

  return true
}

nonisolated func kayleShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    isKayleShareField(field.key)
  }
}

nonisolated func visibleKayleShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  kayleShareRequestFields(shareRequest).filter { field in
    isPubliclyVisibleShareField(field.key)
  }
}

/// When `date_of_birth` is required, any `age_over_X` is implicit — the
/// developer receives it for ergonomics (computed server-side from DOB), but
/// the holder doesn't need to see or pick it separately.
nonisolated func isImplicitAgeGateField(
  _ key: String,
  shareRequest: VerifyShareRequest?
) -> Bool {
  guard parseAgeOverThreshold(key) != nil else {
    return false
  }
  guard let shareRequest else {
    return false
  }
  return shareRequest.fields.contains { field in
    field.key == "date_of_birth" && field.required
  }
}

nonisolated func requiredShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
  }
}

nonisolated func optionalShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    !field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
  }
}

nonisolated func displayNameForShareField(
  _ key: String,
  previewContext: VerifySharePreviewContext? = nil,
  referenceDate: Date = Date()
) -> String {
  if let displayName = shareFieldDisplayName(key) {
    return displayName
  }

  if let threshold = parseAgeOverThreshold(key) {
    if
      let birthDate = previewContext?.birthDate,
      let parsedBirthDate = parseSharePreviewDate(
        birthDate,
        key: "date_of_birth",
        referenceDate: referenceDate
      )
    {
      let meetsThreshold = ageInYears(
        from: parsedBirthDate,
        referenceDate: referenceDate
      ) >= threshold

      return meetsThreshold ? "Over \(threshold)" : "Under \(threshold)"
    }

    return "Over \(threshold)"
  }

  return key
    .split(separator: "_")
    .map { segment in
      if segment == "id" {
        return "ID"
      }

      return segment.prefix(1).uppercased() + segment.dropFirst()
    }
    .joined(separator: " ")
}

nonisolated private func isAsciiDigit(_ character: Character) -> Bool {
  character >= "0" && character <= "9"
}

nonisolated private func isISODateText(_ value: String) -> Bool {
  let characters = Array(value)
  guard characters.count == 10 else {
    return false
  }

  for index in [0, 1, 2, 3, 5, 6, 8, 9] {
    if !isAsciiDigit(characters[index]) {
      return false
    }
  }

  return characters[4] == "-" && characters[7] == "-"
}

nonisolated private func isCompactDigitDateText(_ value: String, expectedCount: Int) -> Bool {
  value.count == expectedCount && value.allSatisfy(isAsciiDigit)
}

nonisolated private func parseAgeOverThreshold(_ value: String) -> Int? {
  guard value.hasPrefix("age_over_") else {
    return nil
  }

  let thresholdText = String(value.dropFirst("age_over_".count))
  guard !thresholdText.isEmpty, thresholdText.allSatisfy(isAsciiDigit) else {
    return nil
  }

  return Int(thresholdText)
}

nonisolated private func parseFourDigitYearDate(_ value: String) -> Date? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)

  if isISODateText(trimmed) {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.date(from: trimmed)
  }

  if isCompactDigitDateText(trimmed, expectedCount: 8) {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd"
    return formatter.date(from: trimmed)
  }

  return nil
}

nonisolated private func resolveMRZYear(
  yearSuffix: Int,
  yearRange: ClosedRange<Int>
) -> Int? {
  let baseCentury = (yearRange.upperBound / 100) * 100
  let candidates = [
    baseCentury - 100 + yearSuffix,
    baseCentury + yearSuffix,
    baseCentury + 100 + yearSuffix,
  ]

  return candidates
    .filter { yearRange.contains($0) }
    .sorted()
    .last
}

nonisolated private func parseMRZDate(
  _ value: String,
  yearRange: ClosedRange<Int>
) -> Date? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard isCompactDigitDateText(trimmed, expectedCount: 6) else {
    return nil
  }

  guard
    let yearSuffix = Int(trimmed.prefix(2)),
    let month = Int(trimmed.dropFirst(2).prefix(2)),
    let day = Int(trimmed.suffix(2)),
    let year = resolveMRZYear(yearSuffix: yearSuffix, yearRange: yearRange)
  else {
    return nil
  }

  var components = DateComponents()
  components.calendar = Calendar(identifier: .gregorian)
  components.timeZone = TimeZone(secondsFromGMT: 0)
  components.year = year
  components.month = month
  components.day = day
  return components.date
}

nonisolated private func parseSharePreviewDate(
  _ value: String,
  key: String,
  referenceDate: Date = Date()
) -> Date? {
  let nowYear = Calendar(identifier: .gregorian).component(.year, from: referenceDate)

  if let parsedDate = parseFourDigitYearDate(value) {
    return parsedDate
  }

  if key == "date_of_birth" {
    return parseMRZDate(value, yearRange: (nowYear - 130)...nowYear)
  }

  if key == "document_expiry_date" {
    return parseMRZDate(value, yearRange: (nowYear - 50)...(nowYear + 50))
  }

  return nil
}

nonisolated private func formatDisplayDate(
  _ value: String,
  key: String,
  referenceDate: Date = Date()
) -> String? {
  let parsedDate = parseSharePreviewDate(value, key: key, referenceDate: referenceDate)

  guard let parsedDate else {
    return nil
  }

  let formatter = DateFormatter()
  formatter.calendar = Calendar(identifier: .gregorian)
  formatter.locale = Locale(identifier: "en_GB")
  formatter.timeZone = TimeZone(secondsFromGMT: 0)
  formatter.dateFormat = "dd/MM/yyyy"
  return formatter.string(from: parsedDate)
}

nonisolated private func ageInYears(from birthDate: Date, referenceDate: Date) -> Int {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current

  let birthDateComponents = calendar.dateComponents([.year, .month, .day], from: birthDate)
  let referenceDateComponents = calendar.dateComponents([.year, .month, .day], from: referenceDate)

  guard
    let birthYear = birthDateComponents.year,
    let birthMonth = birthDateComponents.month,
    let birthDay = birthDateComponents.day,
    let referenceYear = referenceDateComponents.year,
    let referenceMonth = referenceDateComponents.month,
    let referenceDay = referenceDateComponents.day
  else {
    return 0
  }

  var age = referenceYear - birthYear
  let monthDelta = referenceMonth - birthMonth
  let dayDelta = referenceDay - birthDay

  if monthDelta < 0 || (monthDelta == 0 && dayDelta < 0) {
    age -= 1
  }

  return age
}

nonisolated private func formatSex(_ value: String) -> String {
  switch value.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() {
  case "M":
    return String(localized: "Male")
  case "F":
    return String(localized: "Female")
  case "X":
    return String(localized: "Unspecified")
  default:
    return value
  }
}

nonisolated func shareFieldDetailText(
  _ field: VerifyShareRequestField,
  previewContext: VerifySharePreviewContext?,
  referenceDate: Date = Date()
) -> String {
  let key = field.key

  let verifiedFromDocument = String(localized: "Verified from your document.")

  switch key {
  case "document_type_code":
    return previewContext?.documentType ?? verifiedFromDocument
  case "issuing_country_code":
    return previewContext?.issuingCountry ?? verifiedFromDocument
  case "family_name":
    return previewContext?.surname ?? verifiedFromDocument
  case "given_names":
    return previewContext?.givenNames ?? verifiedFromDocument
  case "document_number":
    return previewContext?.documentNumber ?? verifiedFromDocument
  case "nationality_code":
    return previewContext?.nationality ?? verifiedFromDocument
  case "date_of_birth":
    if
      let birthDate = previewContext?.birthDate,
      let formattedDate = formatDisplayDate(
        birthDate,
        key: key,
        referenceDate: referenceDate
      )
    {
      return formattedDate
    }
    return previewContext?.birthDate ?? verifiedFromDocument
  case "sex_marker":
    if let sex = previewContext?.sex {
      return formatSex(sex)
    }
    return verifiedFromDocument
  case "document_expiry_date":
    if
      let expiryDate = previewContext?.expiryDate,
      let formattedDate = formatDisplayDate(
        expiryDate,
        key: key,
        referenceDate: referenceDate
      )
    {
      return formattedDate
    }
    return previewContext?.expiryDate ?? verifiedFromDocument
  case "mrz_optional_data":
    return previewContext?.optionalData
      ?? String(localized: "Additional machine-readable document data.")
  case "document_photo":
    return String(localized: "Photo securely read from your document chip.")
  case "kayle_document_id":
    return String(
      localized: "Required security identifier for this verified document."
    )
  case "kayle_human_id":
    return String(localized: "Reserved placeholder for a future human identifier.")
  default:
    if let threshold = parseAgeOverThreshold(key) {
      if
        let birthDate = previewContext?.birthDate,
        let parsedBirthDate = parseSharePreviewDate(
          birthDate,
          key: "date_of_birth",
          referenceDate: referenceDate
        )
      {
        let meetsThreshold = ageInYears(
          from: parsedBirthDate,
          referenceDate: referenceDate
        ) >= threshold

        return meetsThreshold
          ? String(
              localized:
                "Will share that you meet the \(threshold)+ age requirement."
            )
          : String(
              localized:
                "Will share that you do not meet the \(threshold)+ age requirement."
            )
      }

      return String(
        localized: "Shares whether you meet the \(threshold)+ age requirement."
      )
    }

    return field.reason
  }
}

nonisolated func isNonRetryableAuthErrorCode(_ code: String) -> Bool {
  switch code {
  case "HELLO_AUTH_REQUIRED",
    "ATTEMPT_NOT_FOUND",
    "HANDOFF_TOKEN_INVALID",
    "HANDOFF_TOKEN_EXPIRED",
    "HANDOFF_TOKEN_CONSUMED",
    "HANDOFF_DEVICE_MISMATCH",
    "HELLO_ATTEST_INVALID",
    "HELLO_ATTEST_KEY_UNKNOWN",
    "MIN_APP_VERSION_REQUIRED":
    return true
  default:
    return false
  }
}

nonisolated func isVerificationSessionConnectionLoss(
  _ error: VerifyWebSocketError
) -> Bool {
  switch error {
  case .connectionClosed,
    .notConnected,
    .sendFailed,
    .sendFailedWithReason,
    .helloTimedOut,
    .serverResponseTimedOut,
    .reconnectFailed:
    return true
  default:
    return false
  }
}

nonisolated func shouldRetryReconnect(
  isAuthenticated: Bool,
  lastErrorCode: String?,
  attempt: Int,
  maxAttempts: Int
) -> Bool {
  guard isAuthenticated, attempt > 0, attempt <= maxAttempts else {
    return false
  }

  if let code = lastErrorCode, isNonRetryableAuthErrorCode(code) {
    return false
  }

  return true
}
