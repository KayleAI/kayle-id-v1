import Foundation

enum VerifyDataKind: Int, Sendable {
  case dg1 = 0
  case dg2 = 1
  case sod = 2
  case selfie = 3
  case dg14 = 4
  case dg15 = 5
  case activeAuth = 6
  case chipAuth = 7
  case livenessVideo = 8
}

struct VerifyDataUploadRequest: Sendable {
  let kind: VerifyDataKind
  let raw: Data
  let index: Int
  let total: Int
  let chunkIndex: Int
  let chunkTotal: Int
}

struct VerifyServerLivenessChallenge {
  let maxDurationMs: UInt32
  let challengeNonce: Data
}

nonisolated final class OneShotContinuation<Value>: @unchecked Sendable {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<Value, Error>?

  init(_ continuation: CheckedContinuation<Value, Error>) {
    self.continuation = continuation
  }

  func resume(returning value: Value) {
    resume(with: .success(value))
  }

  func resume(throwing error: Error) {
    resume(with: .failure(error))
  }

  private func resume(with result: Result<Value, Error>) {
    lock.lock()
    let pendingContinuation = continuation
    continuation = nil
    lock.unlock()

    guard let pendingContinuation else {
      return
    }

    switch result {
    case .success(let value):
      pendingContinuation.resume(returning: value)
    case .failure(let error):
      pendingContinuation.resume(throwing: error)
    }
  }
}
