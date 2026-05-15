import Foundation

enum MRZFormat: String {
  case td1 = "TD1"
  case td2 = "TD2"
  case td3 = "TD3"
}

struct MRZResult: Equatable {
  let format: MRZFormat
  let documentType: String
  let issuingCountry: String
  let surnames: String
  let givenNames: String

  let documentNumber: String
  let documentNumberRaw: String
  let documentNumberCheckDigit: Character
  let nationality: String
  let birthDateYYMMDD: String
  let birthDateCheckDigit: Character
  let sex: String
  let expiryDateYYMMDD: String
  let expiryDateCheckDigit: Character
  let optionalData: String

  let checks: Checks

  struct Checks: Equatable {
    let lineLengthsOK: Bool
    let charsetOK: Bool
    let documentNumberOK: Bool
    let birthDateOK: Bool
    let expiryDateOK: Bool
    let optionalDataOK: Bool
    let compositeOK: Bool

    var isValid: Bool {
      lineLengthsOK && charsetOK &&
      documentNumberOK && birthDateOK && expiryDateOK
    }
  }

  /// MRZ key used for NFC BAC authentication.
  var mrzKey: String {
    documentNumberRaw + String(documentNumberCheckDigit) +
    birthDateYYMMDD + String(birthDateCheckDigit) +
    expiryDateYYMMDD + String(expiryDateCheckDigit)
  }

  /// Derived from ICAO 9303 document type codes (the first two characters of
  /// MRZ line 1). Used to tailor user-facing copy after the MRZ scan.
  enum DocumentCategory {
    case passport
    case idCard
    case residencePermit
    case other
  }

  var documentCategory: DocumentCategory {
    let normalized = documentType.replacingOccurrences(of: "<", with: "")
    guard let first = normalized.first else {
      return .other
    }

    let second = normalized.dropFirst().first

    switch first {
    case "P":
      return .passport
    case "I":
      if second == "R" {
        return .residencePermit
      }
      return .idCard
    case "A", "C":
      return .idCard
    default:
      return .other
    }
  }

  var userFacingDocumentName: String {
    switch documentCategory {
    case .passport: return String(localized: "passport")
    case .idCard: return String(localized: "ID card")
    case .residencePermit: return String(localized: "residence permit")
    case .other: return String(localized: "document")
    }
  }

  var userFacingDocumentNameWithArticle: String {
    switch documentCategory {
    case .passport: return String(localized: "a passport")
    case .idCard: return String(localized: "an ID card")
    case .residencePermit: return String(localized: "a residence permit")
    case .other: return String(localized: "a document")
    }
  }

  var userFacingRFIDSymbolLocationDescription: String {
    switch documentCategory {
    case .passport: return String(localized: "your passport")
    case .idCard: return String(localized: "your ID card")
    case .residencePermit: return String(localized: "your residence permit")
    case .other: return String(localized: "your document")
    }
  }

  var userFacingDocumentChipName: String {
    switch documentCategory {
    case .passport: return String(localized: "passport chip")
    case .idCard: return String(localized: "ID card chip")
    case .residencePermit: return String(localized: "residence permit chip")
    case .other: return String(localized: "document chip")
    }
  }

  /// Convert to JSON-encodable dictionary for E2EE upload.
  func toUploadData() throws -> Data {
    let dict: [String: Any] = [
      "raw": "\(documentType)\(issuingCountry)\(surnames)<<\(givenNames)",
      "parsed": [
        "documentType": documentType,
        "issuingCountry": issuingCountry,
        "surname": surnames,
        "givenNames": givenNames,
        "documentNumber": documentNumber,
        "nationality": nationality,
        "dateOfBirth": birthDateYYMMDD,
        "sex": sex,
        "expiryDate": expiryDateYYMMDD,
        "optionalData": optionalData
      ],
      "checks": [
        "documentNumber": checks.documentNumberOK,
        "dateOfBirth": checks.birthDateOK,
        "expiryDate": checks.expiryDateOK,
        "composite": checks.compositeOK
      ]
    ]
    return try JSONSerialization.data(withJSONObject: dict)
  }
}
