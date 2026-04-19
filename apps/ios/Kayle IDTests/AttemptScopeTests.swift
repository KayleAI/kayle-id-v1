import XCTest
@testable import KayleIDModels

final class AttemptScopeTests: XCTestCase {
  func testIgnoresEventWhenThereIsNoActiveAttempt() {
    XCTAssertFalse(
      shouldHandleAttemptScopedEvent(
        currentAttemptId: nil,
        eventAttemptId: "va_old_attempt"
      )
    )
  }

  func testAllowsUntaggedEventForActiveAttempt() {
    XCTAssertTrue(
      shouldHandleAttemptScopedEvent(
        currentAttemptId: "va_current_attempt",
        eventAttemptId: nil
      )
    )
  }

  func testIgnoresLateEventFromPreviousAttempt() {
    XCTAssertFalse(
      shouldHandleAttemptScopedEvent(
        currentAttemptId: "va_current_attempt",
        eventAttemptId: "va_previous_attempt"
      )
    )
  }

  func testHandlesEventForCurrentAttempt() {
    XCTAssertTrue(
      shouldHandleAttemptScopedEvent(
        currentAttemptId: "va_current_attempt",
        eventAttemptId: "va_current_attempt"
      )
    )
  }

  func testPreventsDeviceSleepDuringActiveNonTerminalVerification() {
    XCTAssertTrue(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveAttempt: true,
        isTerminalStep: false
      )
    )
  }

  func testAllowsDeviceSleepWhenThereIsNoActiveVerificationAttempt() {
    XCTAssertFalse(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveAttempt: false,
        isTerminalStep: false
      )
    )
  }

  func testAllowsDeviceSleepAfterVerificationReachesTerminalStep() {
    XCTAssertFalse(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveAttempt: true,
        isTerminalStep: true
      )
    )
  }
}
