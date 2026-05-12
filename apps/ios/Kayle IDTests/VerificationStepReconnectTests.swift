import XCTest
@testable import KayleIDModels

final class VerificationStepReconnectTests: XCTestCase {
  func testTerminalAndPreSessionStepsAreNotReconnectable() {
    XCTAssertFalse(isVerificationStepReconnectable(.welcome))
    XCTAssertFalse(isVerificationStepReconnectable(.scanning))
    XCTAssertFalse(isVerificationStepReconnectable(.complete))
    XCTAssertFalse(isVerificationStepReconnectable(.error))
  }

  func testInFlightStepsAreReconnectable() {
    XCTAssertTrue(isVerificationStepReconnectable(.mrz))
    XCTAssertTrue(isVerificationStepReconnectable(.rfidCheck))
    XCTAssertTrue(isVerificationStepReconnectable(.rfidUnsupported))
    XCTAssertTrue(isVerificationStepReconnectable(.nfc))
    XCTAssertTrue(isVerificationStepReconnectable(.selfieIntro))
    XCTAssertTrue(isVerificationStepReconnectable(.selfie))
    XCTAssertTrue(isVerificationStepReconnectable(.shareDetails))
  }

  func testAllCasesAreCovered() {
    // Trip a compile-time failure if a new step is added but not classified.
    for step in VerificationStep.allCases {
      _ = isVerificationStepReconnectable(step)
    }
  }
}
