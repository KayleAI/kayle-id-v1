import Foundation

enum MRZParseError: Error {
  case notEnoughLines
  case wrongLength
  case invalidCharset
  case unsupportedDocumentType
}

enum MRZParser {
  private static let td1LineLength = 30
  private static let td2LineLength = 36
  private static let td3LineLength = 44

  static func parseAndValidate(_ raw: String) throws -> MRZResult {
    let lines = normalise(raw)
      .split(separator: "\n", omittingEmptySubsequences: true)
      .map(String.init)

    if lines.count < 2 {
      throw MRZParseError.notEnoughLines
    }

    if lines.count == 2 {
      let l1 = lines[0]
      let l2 = lines[1]

      guard charsetOK(l1) && charsetOK(l2) else {
        throw MRZParseError.invalidCharset
      }

      if l1.count == td3LineLength && l2.count == td3LineLength {
        return parseTD3(l1, l2)
      }

      if l1.count == td2LineLength && l2.count == td2LineLength {
        return parseTD2(l1, l2)
      }

      throw MRZParseError.wrongLength
    }

    if lines.count == 3 {
      let l1 = lines[0]
      let l2 = lines[1]
      let l3 = lines[2]

      guard l1.count == td1LineLength, l2.count == td1LineLength, l3.count == td1LineLength else {
        throw MRZParseError.wrongLength
      }

      guard charsetOK(l1) && charsetOK(l2) && charsetOK(l3) else {
        throw MRZParseError.invalidCharset
      }

      return parseTD1(l1, l2, l3)
    }

    throw MRZParseError.wrongLength
  }

  static func extractCandidate(fromOCRLines lines: [String]) -> String? {
    let normalised = lines.map { normaliseLine($0) }.filter { !$0.isEmpty }

    if let td3Candidate = extractTD3Candidate(from: normalised) {
      return td3Candidate
    }

    if let td1Candidate = extractTD1Candidate(from: normalised) {
      return td1Candidate
    }

    if let td2Candidate = extractTD2Candidate(from: normalised) {
      return td2Candidate
    }

    return nil
  }

  // MARK: - TD3

  private static func parseTD3(_ l1: String, _ l2: String) -> MRZResult {
    let documentType = String(l1.prefix(2))
    let issuingCountry = String(l1.slice(2, 5))
    let nameField = String(l1.suffix(39))
    let (surnames, givenNames) = parseNames(nameField)

    let docNumberField = String(l2.slice(0, 9))
    let docNumberCD = char(l2, 9)

    let nationality = String(l2.slice(10, 13))

    let birthDate = String(l2.slice(13, 19))
    let birthDateCD = char(l2, 19)

    let sex = String(char(l2, 20))

    let expiryDate = String(l2.slice(21, 27))
    let expiryDateCD = char(l2, 27)

    let personalNumber = String(l2.slice(28, 42))
    let personalNumberCD = char(l2, 42)
    let compositeCD = char(l2, 43)

    let documentNumberOK = checkDigit(docNumberField) == docNumberCD
    let birthDateOK = checkDigit(birthDate) == birthDateCD
    let expiryDateOK = checkDigit(expiryDate) == expiryDateCD
    let optionalDataOK = checkDigit(personalNumber) == personalNumberCD

    let compositeData =
      String(l2.slice(0, 10)) +
      String(l2.slice(13, 20)) +
      String(l2.slice(21, 28)) +
      String(l2.slice(28, 43))
    let compositeOK = checkDigit(compositeData) == compositeCD

    return MRZResult(
      format: .td3,
      documentType: documentType,
      issuingCountry: issuingCountry,
      surnames: surnames,
      givenNames: givenNames,
      documentNumber: unfill(docNumberField),
      documentNumberRaw: docNumberField,
      documentNumberCheckDigit: docNumberCD,
      nationality: nationality,
      birthDateYYMMDD: birthDate,
      birthDateCheckDigit: birthDateCD,
      sex: sex,
      expiryDateYYMMDD: expiryDate,
      expiryDateCheckDigit: expiryDateCD,
      optionalData: unfill(personalNumber),
      checks: .init(
        lineLengthsOK: true,
        charsetOK: true,
        documentNumberOK: documentNumberOK,
        birthDateOK: birthDateOK,
        expiryDateOK: expiryDateOK,
        optionalDataOK: optionalDataOK,
        compositeOK: compositeOK
      )
    )
  }

  // MARK: - TD2 (ID-2)

  private static func parseTD2(_ l1: String, _ l2: String) -> MRZResult {
    let documentType = String(l1.prefix(2))
    let issuingCountry = String(l1.slice(2, 5))
    let nameField = String(l1.suffix(31))
    let (surnames, givenNames) = parseNames(nameField)

    let docNumberField = String(l2.slice(0, 9))
    let docNumberCD = char(l2, 9)

    let nationality = String(l2.slice(10, 13))

    let birthDate = String(l2.slice(13, 19))
    let birthDateCD = char(l2, 19)

    let sex = String(char(l2, 20))

    let expiryDate = String(l2.slice(21, 27))
    let expiryDateCD = char(l2, 27)

    let optionalData = String(l2.slice(28, 35))
    let compositeCD = char(l2, 35)

    let documentNumberOK = checkDigit(docNumberField) == docNumberCD
    let birthDateOK = checkDigit(birthDate) == birthDateCD
    let expiryDateOK = checkDigit(expiryDate) == expiryDateCD

    let compositeData =
      String(l2.slice(0, 10)) +
      String(l2.slice(13, 20)) +
      String(l2.slice(21, 28)) +
      String(l2.slice(28, 35))
    let compositeOK = checkDigit(compositeData) == compositeCD

    return MRZResult(
      format: .td2,
      documentType: documentType,
      issuingCountry: issuingCountry,
      surnames: surnames,
      givenNames: givenNames,
      documentNumber: unfill(docNumberField),
      documentNumberRaw: docNumberField,
      documentNumberCheckDigit: docNumberCD,
      nationality: nationality,
      birthDateYYMMDD: birthDate,
      birthDateCheckDigit: birthDateCD,
      sex: sex,
      expiryDateYYMMDD: expiryDate,
      expiryDateCheckDigit: expiryDateCD,
      optionalData: unfill(optionalData),
      checks: .init(
        lineLengthsOK: true,
        charsetOK: true,
        documentNumberOK: documentNumberOK,
        birthDateOK: birthDateOK,
        expiryDateOK: expiryDateOK,
        optionalDataOK: true,
        compositeOK: compositeOK
      )
    )
  }

  // MARK: - TD1 (ID-1)

  private static func parseTD1(_ l1: String, _ l2: String, _ l3: String) -> MRZResult {
    let documentType = String(l1.prefix(2))
    let issuingCountry = String(l1.slice(2, 5))

    let docNumberField = String(l1.slice(5, 14))
    let docNumberCD = char(l1, 14)
    let optional1 = String(l1.slice(15, 30))

    let birthDate = String(l2.slice(0, 6))
    let birthDateCD = char(l2, 6)
    let sex = String(char(l2, 7))
    let expiryDate = String(l2.slice(8, 14))
    let expiryDateCD = char(l2, 14)
    let nationality = String(l2.slice(15, 18))
    let optional2 = String(l2.slice(18, 29))
    let compositeCD = char(l2, 29)

    let nameField = l3
    let (surnames, givenNames) = parseNames(nameField)

    let documentNumberOK = checkDigit(docNumberField) == docNumberCD
    let birthDateOK = checkDigit(birthDate) == birthDateCD
    let expiryDateOK = checkDigit(expiryDate) == expiryDateCD

    let compositeData =
      docNumberField + String(docNumberCD) +
      optional1 +
      birthDate + String(birthDateCD) +
      expiryDate + String(expiryDateCD) +
      optional2
    let compositeOK = checkDigit(compositeData) == compositeCD

    return MRZResult(
      format: .td1,
      documentType: documentType,
      issuingCountry: issuingCountry,
      surnames: surnames,
      givenNames: givenNames,
      documentNumber: unfill(docNumberField),
      documentNumberRaw: docNumberField,
      documentNumberCheckDigit: docNumberCD,
      nationality: nationality,
      birthDateYYMMDD: birthDate,
      birthDateCheckDigit: birthDateCD,
      sex: sex,
      expiryDateYYMMDD: expiryDate,
      expiryDateCheckDigit: expiryDateCD,
      optionalData: unfill(optional1 + optional2),
      checks: .init(
        lineLengthsOK: true,
        charsetOK: true,
        documentNumberOK: documentNumberOK,
        birthDateOK: birthDateOK,
        expiryDateOK: expiryDateOK,
        optionalDataOK: true,
        compositeOK: compositeOK
      )
    )
  }

  // MARK: - Helpers

  private static func extractTD3Candidate(from lines: [String]) -> String? {
    let candidates = lines.filter { $0.count == td3LineLength }
    let headers = candidates
      .filter { td3HeaderLooksValid($0) }
      .sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let dataLines = candidates
      .filter { !td3HeaderLooksValid($0) }
      .sorted { scoreTDDataLine($0) > scoreTDDataLine($1) }

    for header in headers {
      for dataLine in dataLines {
        let candidate = "\(header)\n\(dataLine)"
        if candidateLooksValidForScan(candidate) {
          return candidate
        }
      }
    }

    guard let header = headers.first, let dataLine = dataLines.first else {
      return nil
    }

    return "\(header)\n\(dataLine)"
  }

  private static func extractTD1Candidate(from lines: [String]) -> String? {
    let candidates = lines.filter { $0.count == td1LineLength }

    for header in candidates where mrzLineLooksLikeDocumentHeader(header) {
      for detailLine in candidates where detailLine != header {
        for nameLine in candidates where nameLine != header && nameLine != detailLine && nameLine.contains("<<") {
          let candidate = "\(header)\n\(detailLine)\n\(nameLine)"
          if candidateLooksValidForScan(candidate) {
            return candidate
          }
        }
      }
    }

    let ranked = candidates.sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let top = Array(ranked.prefix(3))
    guard
      top.count == 3,
      let header = top.first(where: { mrzLineLooksLikeDocumentHeader($0) })
    else {
      return nil
    }

    let rest = top.filter { $0 != header }
    guard rest.count >= 2 else {
      return nil
    }

    return "\(header)\n\(rest[0])\n\(rest[1])"
  }

  private static func extractTD2Candidate(from lines: [String]) -> String? {
    let candidates = lines.filter { $0.count == td2LineLength }
    let headers = candidates
      .filter { mrzLineLooksLikeDocumentHeader($0) && $0.contains("<<") }
      .sorted { scoreMRZLine($0) > scoreMRZLine($1) }
    let dataLines = candidates
      .filter { !headers.contains($0) }
      .sorted { scoreTDDataLine($0) > scoreTDDataLine($1) }

    for header in headers {
      for dataLine in dataLines {
        let candidate = "\(header)\n\(dataLine)"
        if candidateLooksValidForScan(candidate) {
          return candidate
        }
      }
    }

    guard let header = headers.first, let dataLine = dataLines.first else {
      return nil
    }

    return "\(header)\n\(dataLine)"
  }

  private static func candidateLooksValidForScan(_ candidate: String) -> Bool {
    guard let parsed = try? parseAndValidate(candidate) else {
      return false
    }

    return parsed.checks.isValid
  }

  private static func td3HeaderLooksValid(_ s: String) -> Bool {
    s.first == "P" && s.contains("<<")
  }

  private static func mrzLineLooksLikeDocumentHeader(_ s: String) -> Bool {
    guard let first = s.first else { return false }
    return first == "P" || first == "I" || first == "A" || first == "C"
  }

  private static func scoreMRZLine(_ s: String) -> Int {
    let fillerCount = s.count(where: { $0 == "<" })
    return fillerCount * 10 + s.count
  }

  private static func scoreTDDataLine(_ s: String) -> Int {
    var score = 0

    if characterIsDigit(char(s, 9)) {
      score += 10
    }
    if characterRangeIsLetters(s, 10, 13) {
      score += 10
    }
    if characterRangeIsDigits(s, 13, 19) {
      score += 10
    }
    if characterIsDigit(char(s, 19)) {
      score += 10
    }
    if characterRangeIsDigits(s, 21, 27) {
      score += 10
    }
    if characterIsDigit(char(s, 27)) {
      score += 10
    }

    return score + scoreMRZLine(s)
  }

  private static func characterRangeIsDigits(_ s: String, _ start: Int, _ end: Int) -> Bool {
    s.slice(start, end).allSatisfy { characterIsDigit($0) }
  }

  private static func characterRangeIsLetters(_ s: String, _ start: Int, _ end: Int) -> Bool {
    s.slice(start, end).allSatisfy { $0 >= "A" && $0 <= "Z" }
  }

  private static func characterIsDigit(_ ch: Character) -> Bool {
    ch >= "0" && ch <= "9"
  }

  static func normalise(_ s: String) -> String {
    let up = s.uppercased().replacingOccurrences(of: " ", with: "")
    let allowed = up.filter { ch in
      ch == "\n" || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch == "<"
    }
    return String(allowed)
  }

  private static func normaliseLine(_ s: String) -> String {
    normalise(s).replacingOccurrences(of: "\n", with: "")
  }

  private static func charsetOK(_ s: String) -> Bool {
    s.allSatisfy { ch in
      (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch == "<"
    }
  }

  private static func parseNames(_ field: String) -> (String, String) {
    let raw = field.replacingOccurrences(of: "<<", with: "|")
    let pieces = raw.split(separator: "|", omittingEmptySubsequences: false)
    let surname = pieces.first.map(String.init) ?? ""
    let given = pieces.dropFirst().joined(separator: " ").replacingOccurrences(of: "<", with: " ")
    return (unfill(surname.replacingOccurrences(of: "<", with: " ")).trimmingCharacters(in: .whitespaces),
            unfill(given).trimmingCharacters(in: .whitespaces))
  }

  private static func unfill(_ s: String) -> String {
    s.replacingOccurrences(of: "<", with: "").trimmingCharacters(in: .whitespaces)
  }

  private static func char(_ s: String, _ idx: Int) -> Character {
    s[s.index(s.startIndex, offsetBy: idx)]
  }

  private static func checkDigit(_ data: String) -> Character {
    let weights = [7, 3, 1]
    var sum = 0
    for (i, ch) in data.enumerated() {
      let v = value(ch)
      sum += v * weights[i % 3]
    }
    let cd = sum % 10
    return Character(String(cd))
  }

  private static func value(_ ch: Character) -> Int {
    if ch >= "0" && ch <= "9" {
      return Int(String(ch))!
    }
    if ch >= "A" && ch <= "Z" {
      let scalar = ch.unicodeScalars.first!.value
      return Int(scalar - Character("A").unicodeScalars.first!.value) + 10
    }
    if ch == "<" { return 0 }
    return 0
  }
}

private extension String {
  func slice(_ start: Int, _ end: Int) -> Substring {
    let s = index(self.startIndex, offsetBy: start)
    let e = index(self.startIndex, offsetBy: end)
    return self[s..<e]
  }
}
