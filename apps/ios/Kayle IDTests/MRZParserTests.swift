import XCTest
@testable import KayleIDModels

final class MRZParserTests: XCTestCase {
  func testTD3ParsesSuccessfully() throws {
    let td3 =
      """
      P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
      L898902C36UTO7408122F1204159ZE184226B<<<<<10
      """

    let parsed = try MRZParser.parseAndValidate(td3)

    XCTAssertEqual(parsed.format, .td3)
    XCTAssertEqual(parsed.documentType, "P<")
    XCTAssertTrue(parsed.checks.isValid)
  }

  func testTD3ParsesFullyPopulatedOptionalData() throws {
    let td3 =
      """
      P<UKRIVANENKO<<IVAN<<<<<<<<<<<<<<<<<<<<<<<<<
      EA12345676UKR8801018M30010191234567890123450
      """

    let parsed = try MRZParser.parseAndValidate(td3)

    XCTAssertEqual(parsed.format, .td3)
    XCTAssertEqual(parsed.documentType, "P<")
    XCTAssertEqual(parsed.issuingCountry, "UKR")
    XCTAssertEqual(parsed.documentNumber, "EA1234567")
    XCTAssertEqual(parsed.nationality, "UKR")
    XCTAssertEqual(parsed.optionalData, "12345678901234")
    XCTAssertTrue(parsed.checks.isValid)
    XCTAssertTrue(parsed.checks.optionalDataOK)
    XCTAssertTrue(parsed.checks.compositeOK)
  }

  func testExtractCandidateAcceptsTD3DataLineWithoutFillers() throws {
    let lineOne = "P<UKRIVANENKO<<IVAN<<<<<<<<<<<<<<<<<<<<<<<<<"
    let lineTwo = "EA12345676UKR8801018M30010191234567890123450"

    let candidate = MRZParser.extractCandidate(
      fromOCRLines: [
        "UKRAINE",
        lineOne,
        "RECORD NO 12345678901234",
        lineTwo,
      ]
    )

    XCTAssertEqual(candidate, "\(lineOne)\n\(lineTwo)")

    let parsed = try MRZParser.parseAndValidate(XCTUnwrap(candidate))
    XCTAssertTrue(parsed.checks.isValid)
    XCTAssertEqual(parsed.optionalData, "12345678901234")
  }

  func testTD1ParsesSuccessfully() throws {
    let td1 =
      """
      I<UTOD231458907<<<<<<<<<<<<<<<
      7408122F1204159UTO<<<<<<<<<<<6
      ERIKSSON<<ANNA<MARIA<<<<<<<<<<
      """

    let parsed = try MRZParser.parseAndValidate(td1)

    XCTAssertEqual(parsed.format, .td1)
    XCTAssertEqual(parsed.documentType, "I<")
    XCTAssertEqual(parsed.issuingCountry, "UTO")
    XCTAssertEqual(parsed.documentNumber, "D23145890")
    XCTAssertEqual(parsed.nationality, "UTO")
    XCTAssertEqual(parsed.birthDateYYMMDD, "740812")
    XCTAssertEqual(parsed.expiryDateYYMMDD, "120415")
    XCTAssertEqual(parsed.surnames, "ERIKSSON")
    XCTAssertEqual(parsed.givenNames, "ANNA MARIA")
    XCTAssertTrue(parsed.checks.isValid)
    XCTAssertTrue(parsed.checks.compositeOK)
  }

  func testTD2ParsesSuccessfully() throws {
    let td2 =
      """
      I<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<
      D231458907UTO7408122F1204159<<<<<<<6
      """

    let parsed = try MRZParser.parseAndValidate(td2)

    XCTAssertEqual(parsed.format, .td2)
    XCTAssertEqual(parsed.documentType, "I<")
    XCTAssertEqual(parsed.issuingCountry, "UTO")
    XCTAssertEqual(parsed.documentNumber, "D23145890")
    XCTAssertEqual(parsed.nationality, "UTO")
    XCTAssertEqual(parsed.birthDateYYMMDD, "740812")
    XCTAssertEqual(parsed.expiryDateYYMMDD, "120415")
    XCTAssertEqual(parsed.surnames, "ERIKSSON")
    XCTAssertEqual(parsed.givenNames, "ANNA MARIA")
    XCTAssertTrue(parsed.checks.isValid)
    XCTAssertTrue(parsed.checks.compositeOK)
  }

  // MARK: - Document category copy

  func testTD3PassportCategoryAndCopy() throws {
    let td3 =
      """
      P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
      L898902C36UTO7408122F1204159ZE184226B<<<<<10
      """

    let parsed = try MRZParser.parseAndValidate(td3)

    XCTAssertEqual(parsed.documentCategory, .passport)
    XCTAssertEqual(parsed.userFacingDocumentName, "passport")
    XCTAssertEqual(parsed.userFacingDocumentNameWithArticle, "a passport")
    XCTAssertEqual(parsed.userFacingRFIDSymbolLocationDescription, "your passport")
    XCTAssertEqual(parsed.userFacingDocumentChipName, "passport chip")
  }

  func testTD1IdCardCategoryAndCopy() throws {
    let td1 =
      """
      I<UTOD231458907<<<<<<<<<<<<<<<
      7408122F1204159UTO<<<<<<<<<<<6
      ERIKSSON<<ANNA<MARIA<<<<<<<<<<
      """

    let parsed = try MRZParser.parseAndValidate(td1)

    XCTAssertEqual(parsed.documentCategory, .idCard)
    XCTAssertEqual(parsed.userFacingDocumentName, "ID card")
    XCTAssertEqual(parsed.userFacingDocumentNameWithArticle, "an ID card")
    XCTAssertEqual(parsed.userFacingRFIDSymbolLocationDescription, "your ID card")
    XCTAssertEqual(parsed.userFacingDocumentChipName, "ID card chip")
  }

  func testResidencePermitCategoryAndCopy() {
    let result = MRZResultFixture.make(format: .td2, documentType: "IR")

    XCTAssertEqual(result.documentCategory, .residencePermit)
    XCTAssertEqual(result.userFacingDocumentName, "residence permit")
    XCTAssertEqual(result.userFacingDocumentNameWithArticle, "a residence permit")
    XCTAssertEqual(result.userFacingRFIDSymbolLocationDescription, "your residence permit")
    XCTAssertEqual(result.userFacingDocumentChipName, "residence permit chip")
  }

  func testCrewCertificateMapsToIdCardCopy() {
    let result = MRZResultFixture.make(format: .td1, documentType: "AC")

    XCTAssertEqual(result.documentCategory, .idCard)
    XCTAssertEqual(result.userFacingDocumentName, "ID card")
  }

  func testUnknownDocumentTypeFallsBackToDocumentCopy() {
    let result = MRZResultFixture.make(format: .td3, documentType: "V<")

    XCTAssertEqual(result.documentCategory, .other)
    XCTAssertEqual(result.userFacingDocumentName, "document")
    XCTAssertEqual(result.userFacingDocumentNameWithArticle, "a document")
    XCTAssertEqual(result.userFacingRFIDSymbolLocationDescription, "your document")
    XCTAssertEqual(result.userFacingDocumentChipName, "document chip")
  }

  func testPassportFillerCharactersStillResolveToPassport() {
    let result = MRZResultFixture.make(format: .td3, documentType: "P<")

    XCTAssertEqual(result.documentCategory, .passport)
    XCTAssertEqual(result.userFacingDocumentName, "passport")
  }
}

private enum MRZResultFixture {
  static func make(format: MRZFormat = .td1, documentType: String) -> MRZResult {
    MRZResult(
      format: format,
      documentType: documentType,
      issuingCountry: "UTO",
      surnames: "DOE",
      givenNames: "JANE",
      documentNumber: "000000000",
      documentNumberRaw: "000000000",
      documentNumberCheckDigit: "0",
      nationality: "UTO",
      birthDateYYMMDD: "000101",
      birthDateCheckDigit: "0",
      sex: "F",
      expiryDateYYMMDD: "300101",
      expiryDateCheckDigit: "0",
      optionalData: "",
      checks: MRZResult.Checks(
        lineLengthsOK: true,
        charsetOK: true,
        documentNumberOK: true,
        birthDateOK: true,
        expiryDateOK: true,
        optionalDataOK: true,
        compositeOK: true
      )
    )
  }
}
