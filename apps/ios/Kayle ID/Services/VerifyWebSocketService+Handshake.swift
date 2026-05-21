import Foundation
import UIKit

extension VerifyWebSocketService {
  func sendHello() async throws {
    let (deviceId, appVersion) = await resolveHelloMetadata()

    var attestKeyId = ""
    var helloAssertion = Data()
    if let challenge = attestHelloChallenge, !challenge.isEmpty {
      do {
        let helloBaseURL = baseURL
        let helloSessionId = sessionId
        let result = try await runWithTimeout(
          nanoseconds: helloAttestationTimeoutNs
        ) {
          try await AppAttestService.shared.helloAssertion(
            baseURL: helloBaseURL,
            sessionId: helloSessionId,
            deviceId: deviceId,
            appVersion: appVersion,
            challenge: challenge
          )
        }
        attestKeyId = result.keyId
        helloAssertion = result.assertion
      } catch {
        #if DEBUG
        print("AppAttest helloAssertion failed: \(error.localizedDescription)")
        #endif
      }
    }

    let runtimeIntegritySignal = await MainActor.run {
      RuntimeIntegrity.currentSignal()
    }

    guard let payload = codec.encodeHello(
      sessionId: sessionId,
      mobileWriteToken: mobileWriteToken,
      deviceId: deviceId,
      appVersion: appVersion,
      attestKeyId: attestKeyId,
      helloAssertion: helloAssertion,
      runtimeIntegritySignal: runtimeIntegritySignal
    ) else {
      throw VerifyWebSocketError.sendFailed
    }
    #if DEBUG
    print("WS -> hello attestKeyIdPresent=\(!attestKeyId.isEmpty) assertionBytes=\(helloAssertion.count) integrity=\(runtimeIntegritySignal)")
    #endif
    let responseTask = Task { try await waitForHelloResponse() }
    do {
      try await send(data: payload)
      try await responseTask.value
    } catch {
      responseTask.cancel()
      if let wsError = error as? VerifyWebSocketError {
        throw wsError
      }
      throw VerifyWebSocketError.sendFailedWithReason(error.localizedDescription)
    }
  }

  func resolvePendingHello(_ result: Result<Void, VerifyWebSocketError>) {
    let continuation: CheckedContinuation<Void, Error>? = stateQueue.sync {
      let pending = pendingHelloContinuation
      pendingHelloContinuation = nil
      helloTimeoutTask?.cancel()
      helloTimeoutTask = nil
      return pending
    }

    guard let continuation else {
      return
    }

    switch result {
    case .success:
      continuation.resume()
    case .failure(let error):
      continuation.resume(throwing: error)
    }
  }

  private func resolveHelloMetadata() async -> (String, String) {
    if let cached = stateQueue.sync(execute: { () -> (String, String)? in
      guard let helloDeviceId, let helloAppVersion else {
        return nil
      }
      return (helloDeviceId, helloAppVersion)
    }) {
      return cached
    }

    let (resolvedDeviceId, resolvedAppVersion) = await MainActor.run {
      let id = UIDevice.current.identifierForVendor?.uuidString ?? "ios-unknown-device"
      let version =
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ??
        "unknown"
      return (id, version)
    }

    stateQueue.sync {
      if helloDeviceId == nil {
        helloDeviceId = resolvedDeviceId
      }
      if helloAppVersion == nil {
        helloAppVersion = resolvedAppVersion
      }
    }

    return (resolvedDeviceId, resolvedAppVersion)
  }

  private func waitForHelloResponse() async throws {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<Void, Error>) in
      stateQueue.sync {
        pendingHelloContinuation = continuation
        helloTimeoutTask?.cancel()
        helloTimeoutTask = Task { [weak self] in
          guard let self else { return }
          do {
            try await Task.sleep(nanoseconds: self.helloAckTimeoutNs)
          } catch {
            return
          }
          self.resolvePendingHello(.failure(.helloTimedOut))
        }
      }
    }
  }

  private func runWithTimeout<T>(
    nanoseconds: UInt64,
    operation: @escaping @Sendable () async throws -> T
  ) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
      group.addTask {
        try await operation()
      }
      group.addTask {
        try await Task.sleep(nanoseconds: nanoseconds)
        throw VerifyWebSocketError.helloTimedOut
      }

      defer {
        group.cancelAll()
      }

      guard let value = try await group.next() else {
        throw VerifyWebSocketError.helloTimedOut
      }

      return value
    }
  }
}
