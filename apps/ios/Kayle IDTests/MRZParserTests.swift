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
