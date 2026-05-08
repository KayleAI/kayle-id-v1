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
}
