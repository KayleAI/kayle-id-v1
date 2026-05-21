import XCTest
@testable import KayleIDModels

final class SessionScopeTests: XCTestCase {
  func testIgnoresEventWhenThereIsNoActiveSession() {
    XCTAssertFalse(
      shouldHandleSessionScopedEvent(
        currentSessionId: nil,
        eventSessionId: "vs_old_session"
      )
    )
  }

  func testAllowsUntaggedEventForActiveSession() {
    XCTAssertTrue(
      shouldHandleSessionScopedEvent(
        currentSessionId: "vs_current_session",
        eventSessionId: nil
      )
    )
  }

  func testIgnoresLateEventFromPreviousSession() {
    XCTAssertFalse(
      shouldHandleSessionScopedEvent(
        currentSessionId: "vs_current_session",
        eventSessionId: "vs_previous_session"
      )
    )
  }

  func testHandlesEventForCurrentSession() {
    XCTAssertTrue(
      shouldHandleSessionScopedEvent(
        currentSessionId: "vs_current_session",
        eventSessionId: "vs_current_session"
      )
    )
  }

  func testPreventsDeviceSleepDuringActiveNonTerminalVerification() {
    XCTAssertTrue(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveSession: true,
        isTerminalStep: false
      )
    )
  }

  func testAllowsDeviceSleepWhenThereIsNoActiveVerificationSession() {
    XCTAssertFalse(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveSession: false,
        isTerminalStep: false
      )
    )
  }

  func testAllowsDeviceSleepAfterVerificationReachesTerminalStep() {
    XCTAssertFalse(
      shouldPreventDeviceSleepDuringVerification(
        hasActiveSession: true,
        isTerminalStep: true
      )
    )
  }
}
