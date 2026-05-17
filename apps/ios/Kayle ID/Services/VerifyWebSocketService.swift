import Foundation
import UIKit

enum VerifyDataKind: Int, Sendable {
  case dg1 = 0
  case dg2 = 1
  case sod = 2
  // selfie @3 is reserved on the wire — the server rejects this value. The
  // case remains here only so the enum is contiguous and Cap'n Proto encoders
  // round-trip correctly.
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

/// Server-issued liveness challenge: replay-defeating nonce + soft
/// capture deadline.
struct VerifyServerLivenessChallenge {
  let maxDurationMs: UInt32
  let challengeNonce: Data
}

nonisolated private final class OneShotContinuation<Value>: @unchecked Sendable {
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

final class VerifyWebSocketService: NSObject, URLSessionWebSocketDelegate {
  // The verification flow keeps the socket open while the user scans MRZ and reads NFC.
  private let requestTimeoutSeconds = 10 * 60.0
  private let resourceTimeoutSeconds = 15 * 60.0
  private let keepaliveIntervalNs: UInt64 = 20_000_000_000
  private let sessionId: String
  private let attemptId: String
  private let mobileWriteToken: String
  private let baseURL: String
  private let attestHelloChallenge: Data?
  private let onFatalError: ((VerifyWebSocketError) -> Void)?
  private let onShareRequest: ((VerifyShareRequest) -> Void)?
  private let onActiveAuthChallenge: ((Data) -> Void)?
  private let onLivenessChallenge: ((VerifyServerLivenessChallenge) -> Void)?
  private let codec = VerifyCapnpCodec()

  private var webSocketTask: URLSessionWebSocketTask?
  private let stateQueue = DispatchQueue(label: "com.kayle.verify.websocket.state")
  private let helloAttestationTimeoutNs: UInt64 = 6_000_000_000
  private let sendTimeoutNs: UInt64 = 8_000_000_000
  private let helloAckTimeoutNs: UInt64 = 8_000_000_000
  private let serverResponseTimeoutNs: UInt64 = 8_000_000_000

  private var isClosing = false
  private var helloDeviceId: String?
  private var helloAppVersion: String?
  private var pendingHelloContinuation: CheckedContinuation<Void, Error>?
  private var helloTimeoutTask: Task<Void, Never>?
  private var pendingServerResponseContinuation: CheckedContinuation<VerifyServerMessage, Error>?
  private var pendingServerResponseAllowsErrorMessage = false
  private var queuedServerResponses: [VerifyServerMessage] = []
  private var serverResponseTimeoutTask: Task<Void, Never>?
  private var expectedCheckResultClose = false
  private var keepaliveTask: Task<Void, Never>?

  private lazy var urlSession: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = requestTimeoutSeconds
    config.timeoutIntervalForResource = resourceTimeoutSeconds
    config.tlsMinimumSupportedProtocolVersion = .TLSv12
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  init(
    sessionId: String,
    attemptId: String,
    mobileWriteToken: String,
    baseURL: String,
    attestHelloChallenge: Data? = nil,
    onFatalError: ((VerifyWebSocketError) -> Void)? = nil,
    onShareRequest: ((VerifyShareRequest) -> Void)? = nil,
    onActiveAuthChallenge: ((Data) -> Void)? = nil,
    onLivenessChallenge: ((VerifyServerLivenessChallenge) -> Void)? = nil
  ) {
    self.sessionId = sessionId
    self.attemptId = attemptId
    self.mobileWriteToken = mobileWriteToken
    self.baseURL = baseURL
    self.attestHelloChallenge = attestHelloChallenge
    self.onFatalError = onFatalError
    self.onShareRequest = onShareRequest
    self.onActiveAuthChallenge = onActiveAuthChallenge
    self.onLivenessChallenge = onLivenessChallenge
    super.init()
  }

  func connect() throws {
    guard let url = websocketURL() else {
      throw VerifyWebSocketError.invalidURL
    }
    stateQueue.sync {
      isClosing = false
      expectedCheckResultClose = false
    }
    startSocket(url: url)
  }

  func sendHello() async throws {
    let (deviceId, appVersion) = await resolveHelloMetadata()

    var attestKeyId = ""
    var helloAssertion = Data()
    if let challenge = attestHelloChallenge, !challenge.isEmpty {
      do {
        let helloBaseURL = baseURL
        let helloAttemptId = attemptId
        let result = try await runWithTimeout(
          nanoseconds: helloAttestationTimeoutNs
        ) {
          try await AppAttestService.shared.helloAssertion(
            baseURL: helloBaseURL,
            attemptId: helloAttemptId,
            deviceId: deviceId,
            appVersion: appVersion,
            challenge: challenge
          )
        }
        attestKeyId = result.keyId
        helloAssertion = result.assertion
      } catch {
        // App Attest unavailable (simulator, jailbroken device, network
        // glitch). The server's gate decides whether to fail-closed; on this
        // side we forward an empty assertion and let the server respond with
        // HELLO_ATTEST_KEY_UNKNOWN.
        #if DEBUG
        print("AppAttest helloAssertion failed: \(error.localizedDescription)")
        #endif
      }
    }

    let runtimeIntegritySignal = await MainActor.run {
      RuntimeIntegrity.currentSignal()
    }

    guard let payload = codec.encodeHello(
      attemptId: attemptId,
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

  func sendPhase(
    _ phase: AttemptPhase,
    error: String?,
    attestAssertion: Data = Data()
  ) async throws {
    let response = try await sendPhaseAwaitResponse(
      phase,
      error: error,
      attestAssertion: attestAssertion
    )
    guard isExpectedPhaseAck(response.ackMessage) else {
      throw VerifyWebSocketError.unexpectedServerResponse(
        describeUnexpectedServerMessage(
          response,
          fallback: String(
            localized:
              "Unexpected verification phase response from the server."
          )
        )
      )
    }
  }

  func sendPhaseAwaitResponse(
    _ phase: AttemptPhase,
    error: String?,
    attestAssertion: Data = Data()
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodePhase(
      phase: phase.rawValue,
      error: error,
      attestAssertion: attestAssertion
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    let responseTask = Task { try await waitForServerResponse() }
    do {
      try await send(data: payload)
      return try await responseTask.value
    } catch {
      responseTask.cancel()
      if let wsError = error as? VerifyWebSocketError {
        throw wsError
      }
      throw VerifyWebSocketError.sendFailedWithReason(error.localizedDescription)
    }
  }

  func sendData(
    kind: VerifyDataKind,
    raw: Data,
    index: Int? = nil,
    total: Int? = nil,
    chunkIndex: Int? = nil,
    chunkTotal: Int? = nil
  ) async throws {
    guard let payload = codec.encodeData(
      kind: kind,
      raw: raw,
      index: index,
      total: total,
      chunkIndex: chunkIndex,
      chunkTotal: chunkTotal
    ) else {
      throw VerifyWebSocketError.sendFailed
    }
    #if DEBUG
    let size = raw.count
    let details = "kind=\(kind) size=\(size) index=\(index ?? 0) total=\(total ?? 0) chunk=\(chunkIndex ?? 0)/\(chunkTotal ?? 0)"
    print("WS -> data \(details)")
    #endif
    try await send(data: payload)
  }

  func sendDataAwaitResponse(
    kind: VerifyDataKind,
    raw: Data,
    index: Int? = nil,
    total: Int? = nil,
    chunkIndex: Int? = nil,
    chunkTotal: Int? = nil
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodeData(
      kind: kind,
      raw: raw,
      index: index,
      total: total,
      chunkIndex: chunkIndex,
      chunkTotal: chunkTotal
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    let responseTask = Task { try await waitForServerResponse() }
    do {
      try await send(data: payload)
      return try await responseTask.value
    } catch {
      responseTask.cancel()
      if let wsError = error as? VerifyWebSocketError {
        throw wsError
      }
      throw VerifyWebSocketError.sendFailedWithReason(error.localizedDescription)
    }
  }

  func sendDataWindowAwaitResponses(
    _ requests: [VerifyDataUploadRequest]
  ) async throws -> [VerifyServerMessage] {
    guard !requests.isEmpty else {
      return []
    }

    var payloads: [Data] = []
    payloads.reserveCapacity(requests.count)

    for request in requests {
      guard let payload = codec.encodeData(
        kind: request.kind,
        raw: request.raw,
        index: request.index,
        total: request.total,
        chunkIndex: request.chunkIndex,
        chunkTotal: request.chunkTotal
      ) else {
        throw VerifyWebSocketError.sendFailed
      }
      payloads.append(payload)
    }

    for (request, payload) in zip(requests, payloads) {
#if DEBUG
      let details = "kind=\(request.kind) size=\(request.raw.count) index=\(request.index) total=\(request.total) chunk=\(request.chunkIndex)/\(request.chunkTotal)"
      print("WS -> data \(details)")
#endif
      try await send(data: payload)
    }

    var responses: [VerifyServerMessage] = []
    responses.reserveCapacity(requests.count)
    for _ in requests {
      responses.append(
        try await waitForServerResponse(allowServerErrorMessage: true)
      )
    }
    return responses
  }

  func sendShareSelectionAwaitResponse(
    sessionId: String,
    selectedFieldKeys: [String]
  ) async throws -> VerifyServerMessage {
    guard let payload = codec.encodeShareSelection(
      sessionId: sessionId,
      selectedFieldKeys: selectedFieldKeys
    ) else {
      throw VerifyWebSocketError.sendFailed
    }

    let responseTask = Task { try await waitForServerResponse() }
    do {
      try await send(data: payload)
      return try await responseTask.value
    } catch {
      responseTask.cancel()
      if let wsError = error as? VerifyWebSocketError {
        throw wsError
      }
      throw VerifyWebSocketError.sendFailedWithReason(error.localizedDescription)
    }
  }

  private func websocketURL() -> URL? {
    let scheme: String
    if baseURL.hasPrefix("https://") {
      scheme = "wss"
    } else if baseURL.hasPrefix("http://") {
      scheme = "ws"
    } else {
      return nil
    }

    let hostPath = baseURL
      .replacingOccurrences(of: "https://", with: "")
      .replacingOccurrences(of: "http://", with: "")

    var components = URLComponents()
    components.scheme = scheme
    let hostParts = hostPath.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true)
    components.host = hostParts.first.map(String.init)
    if hostParts.count > 1, let port = Int(hostParts[1]) {
      components.port = port
    }
    components.path = "/v1/verify/session/\(sessionId)"
#if DEBUG
    components.queryItems = [URLQueryItem(name: "debug", value: "1")]
#endif
    return components.url
  }

  func disconnect() {
    stateQueue.sync {
      isClosing = true
      expectedCheckResultClose = false
    }
    stopKeepalive()
    resolvePendingHello(.failure(.connectionClosed))
    resolvePendingServerResponse(.failure(.connectionClosed))
    closeSocket()
  }

  func reconnectForTransfer() async throws {
    disconnect()
    try connect()
    try await sendHello()
  }

  private func closeSocket() {
    stopKeepalive()
    webSocketTask?.cancel(with: .goingAway, reason: nil)
    webSocketTask = nil
  }

  private func startSocket(url: URL) {
    closeSocket()
    stateQueue.sync {
      expectedCheckResultClose = false
    }
    let task = urlSession.webSocketTask(with: url)
    webSocketTask = task
    task.resume()
    receiveLoop(for: task)
  }

  private func isCurrentTask(_ task: URLSessionWebSocketTask) -> Bool {
    stateQueue.sync {
      webSocketTask === task
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

  private func resolvePendingHello(_ result: Result<Void, VerifyWebSocketError>) {
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

  private func waitForServerResponse(
    allowServerErrorMessage: Bool = false
  ) async throws -> VerifyServerMessage {
    try await withCheckedThrowingContinuation {
      (continuation: CheckedContinuation<VerifyServerMessage, Error>) in
      var immediateResult: Result<VerifyServerMessage, VerifyWebSocketError>?
      stateQueue.sync {
        if !queuedServerResponses.isEmpty {
          let message = queuedServerResponses.removeFirst()
          immediateResult = serverResponseResult(
            for: message,
            allowServerErrorMessage: allowServerErrorMessage
          )
          return
        }

        pendingServerResponseContinuation = continuation
        pendingServerResponseAllowsErrorMessage = allowServerErrorMessage
        serverResponseTimeoutTask?.cancel()
        serverResponseTimeoutTask = Task { [weak self] in
          guard let self else { return }
          do {
            try await Task.sleep(nanoseconds: self.serverResponseTimeoutNs)
          } catch {
            return
          }
          self.resolvePendingServerResponse(.failure(.serverResponseTimedOut))
        }
      }

      if let immediateResult {
        switch immediateResult {
        case .success(let message):
          continuation.resume(returning: message)
        case .failure(let error):
          continuation.resume(throwing: error)
        }
      }
    }
  }

  private func resolvePendingServerResponse(
    _ result: Result<VerifyServerMessage, VerifyWebSocketError>
  ) {
    let continuation: CheckedContinuation<VerifyServerMessage, Error>? = stateQueue.sync {
      let pending = pendingServerResponseContinuation
      pendingServerResponseContinuation = nil
      pendingServerResponseAllowsErrorMessage = false
      serverResponseTimeoutTask?.cancel()
      serverResponseTimeoutTask = nil
      if case .failure = result {
        queuedServerResponses.removeAll()
      }
      return pending
    }

    guard let continuation else {
      return
    }

    switch result {
    case .success(let message):
      continuation.resume(returning: message)
    case .failure(let error):
      continuation.resume(throwing: error)
    }
  }

  private func serverResponseResult(
    for message: VerifyServerMessage,
    allowServerErrorMessage: Bool
  ) -> Result<VerifyServerMessage, VerifyWebSocketError> {
    if let code = message.errorCode, !allowServerErrorMessage {
      return .failure(
        VerifyWebSocketError.serverError(
          code: code,
          message: message.errorMessage ?? code
        )
      )
    }

    return .success(message)
  }

  private func handleServerResponse(_ message: VerifyServerMessage) {
    let resolution: (
      continuation: CheckedContinuation<VerifyServerMessage, Error>,
      result: Result<VerifyServerMessage, VerifyWebSocketError>
    )? = stateQueue.sync {
      guard let continuation = pendingServerResponseContinuation else {
        queuedServerResponses.append(message)
        return nil
      }

      let result = serverResponseResult(
        for: message,
        allowServerErrorMessage: pendingServerResponseAllowsErrorMessage
      )
      pendingServerResponseContinuation = nil
      pendingServerResponseAllowsErrorMessage = false
      serverResponseTimeoutTask?.cancel()
      serverResponseTimeoutTask = nil
      return (continuation, result)
    }

    guard let resolution else {
      return
    }

    switch resolution.result {
    case .success(let message):
      resolution.continuation.resume(returning: message)
    case .failure(let error):
      resolution.continuation.resume(throwing: error)
    }
  }

  private func isAwaitingHelloResponse() -> Bool {
    stateQueue.sync {
      pendingHelloContinuation != nil
    }
  }

  private func isAwaitingServerResponse() -> Bool {
    stateQueue.sync {
      pendingServerResponseContinuation != nil
    }
  }

  private func expectCheckResultClose() {
    stateQueue.sync {
      expectedCheckResultClose = true
    }
  }

  private func consumeExpectedCheckResultClose() -> Bool {
    stateQueue.sync {
      let expected = expectedCheckResultClose
      expectedCheckResultClose = false
      return expected
    }
  }

  private func startKeepalive() {
    stopKeepalive()
    keepaliveTask = Task { [weak self] in
      guard let self else { return }

      while !Task.isCancelled {
        do {
          try await Task.sleep(nanoseconds: keepaliveIntervalNs)
        } catch {
          return
        }

        guard !Task.isCancelled else {
          return
        }

        do {
          try await sendPing()
        } catch let wsError as VerifyWebSocketError {
#if DEBUG
          print("WebSocket keepalive failed: \(wsError.localizedDescription)")
#endif
          handleUnexpectedConnectionLoss()
          return
        } catch {
#if DEBUG
          print("WebSocket keepalive failed: \(error.localizedDescription)")
#endif
          handleUnexpectedConnectionLoss()
          return
        }
      }
    }
  }

  private func stopKeepalive() {
    keepaliveTask?.cancel()
    keepaliveTask = nil
  }

  private func handleFatalError(_ error: VerifyWebSocketError) {
    Task { @MainActor [onFatalError] in
      onFatalError?(error)
    }
  }

  private func handleShareRequest(_ shareRequest: VerifyShareRequest) {
    Task { @MainActor [onShareRequest] in
      onShareRequest?(shareRequest)
    }
  }

  private func handleActiveAuthChallenge(_ challenge: Data) {
    Task { @MainActor [onActiveAuthChallenge] in
      onActiveAuthChallenge?(challenge)
    }
  }

  private func handleLivenessChallenge(
    _ challenge: VerifyServerLivenessChallenge
  ) {
    Task { @MainActor [onLivenessChallenge] in
      onLivenessChallenge?(challenge)
    }
  }

  private func handleUnexpectedConnectionLoss() {
    let shouldHandle = stateQueue.sync { () -> Bool in
      guard !isClosing else {
        return false
      }
      isClosing = true
      expectedCheckResultClose = false
      return true
    }

    guard shouldHandle else {
      return
    }

    stopKeepalive()
    resolvePendingHello(.failure(.connectionClosed))
    resolvePendingServerResponse(.failure(.connectionClosed))
    closeSocket()
    handleFatalError(.connectionClosed)
  }

  private func closeAfterSendFailure() {
    stateQueue.sync {
      isClosing = true
      expectedCheckResultClose = false
    }
    stopKeepalive()
    closeSocket()
    resolvePendingHello(.failure(.connectionClosed))
    resolvePendingServerResponse(.failure(.connectionClosed))
  }

  private func send(data: Data) async throws {
    guard let task = webSocketTask else {
      throw VerifyWebSocketError.notConnected
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let oneShotContinuation = OneShotContinuation(continuation)
      let timeoutTask = Task { [weak self, oneShotContinuation] in
        guard let self else {
          oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
          return
        }

        do {
          try await Task.sleep(nanoseconds: self.sendTimeoutNs)
        } catch {
          return
        }

#if DEBUG
        print("WebSocket send timed out")
#endif
        self.closeAfterSendFailure()
        oneShotContinuation.resume(
          throwing: VerifyWebSocketError.sendFailedWithReason(
            "Timed out sending WebSocket message."
          )
        )
      }

      task.send(.data(data)) { error in
        timeoutTask.cancel()
        if let error {
          if self.isConnectionLossError(error) {
#if DEBUG
            print("WebSocket send failed after connection loss: \(error.localizedDescription)")
#endif
            self.closeAfterSendFailure()
            oneShotContinuation.resume(
              throwing: VerifyWebSocketError.connectionClosed
            )
            return
          }

#if DEBUG
          print("WebSocket send error: \(error.localizedDescription)")
#endif
          oneShotContinuation.resume(
            throwing: VerifyWebSocketError.sendFailedWithReason(
              error.localizedDescription
            )
          )
        } else {
          oneShotContinuation.resume(returning: ())
        }
      }
    }
  }

  private func isConnectionLossError(_ error: Error) -> Bool {
    if let urlError = error as? URLError {
      switch urlError.code {
      case .timedOut, .networkConnectionLost, .notConnectedToInternet:
        return true
      default:
        return false
      }
    }

    let nsError = error as NSError
    guard nsError.domain == NSURLErrorDomain else {
      return false
    }

    switch nsError.code {
    case NSURLErrorTimedOut,
      NSURLErrorNetworkConnectionLost,
      NSURLErrorNotConnectedToInternet:
      return true
    default:
      return false
    }
  }

  private func sendPing() async throws {
    guard let task = webSocketTask else {
      throw VerifyWebSocketError.notConnected
    }

    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let oneShotContinuation = OneShotContinuation(continuation)
      let timeoutTask = Task { [weak self, oneShotContinuation] in
        guard let self else {
          oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
          return
        }

        do {
          try await Task.sleep(nanoseconds: self.sendTimeoutNs)
        } catch {
          return
        }

#if DEBUG
        print("WebSocket ping timed out")
#endif
        self.handleUnexpectedConnectionLoss()
        oneShotContinuation.resume(throwing: VerifyWebSocketError.connectionClosed)
      }

      task.sendPing { error in
        timeoutTask.cancel()
        if let error {
          oneShotContinuation.resume(
            throwing: VerifyWebSocketError.sendFailedWithReason(
              error.localizedDescription
            )
          )
        } else {
          oneShotContinuation.resume(returning: ())
        }
      }
    }
  }

  private func receiveLoop(for task: URLSessionWebSocketTask) {
    task.receive { [weak self] result in
      guard let self else { return }
      guard self.isCurrentTask(task) else { return }
      switch result {
      case .success(let message):
        switch message {
        case .data(let data):
          if let serverMessage = self.codec.decodeServerMessage(data) {
            if let challenge = serverMessage.activeAuthChallenge {
#if DEBUG
              print("WS <- activeAuthChallenge bytes=\(challenge.count)")
#endif
              self.handleActiveAuthChallenge(challenge)
              self.receiveLoop(for: task)
              return
            }
            if let livenessChallenge = serverMessage.livenessChallenge {
#if DEBUG
              print(
                "WS <- livenessChallenge duration=\(livenessChallenge.maxDurationMs)ms nonce=\(livenessChallenge.challengeNonce.count)B"
              )
#endif
              self.handleLivenessChallenge(livenessChallenge)
              self.receiveLoop(for: task)
              return
            }
            let awaitingHello = self.isAwaitingHelloResponse()
            if awaitingHello {
              if let helloResponse = parseHelloResponse(
                ackMessage: serverMessage.ackMessage,
                errorCode: serverMessage.errorCode,
                errorMessage: serverMessage.errorMessage
              ) {
                switch helloResponse {
                case .success:
                  self.startKeepalive()
                  self.resolvePendingHello(.success(()))
                case .failure(let code, let message):
                  let error = VerifyWebSocketError.serverError(
                    code: code,
                    message: message
                  )
                  self.resolvePendingHello(.failure(error))
                  if error.isNonRetryableAuthFailure {
                    self.handleFatalError(error)
                  }
                }
                self.receiveLoop(for: task)
                return
              }
            }

            if self.isAwaitingServerResponse() {
              if let shareRequest = serverMessage.shareRequest {
                self.handleShareRequest(shareRequest)
                self.receiveLoop(for: task)
                return
              }

              if serverMessage.errorCode != nil {
                self.handleServerResponse(serverMessage)
                self.receiveLoop(for: task)
                return
              }

              if let checkResult = serverMessage.checkResult {
                if shouldSuppressReconnectAfterHandledCheckResult(checkResult) {
                  self.expectCheckResultClose()
                }
                self.handleServerResponse(serverMessage)
                self.receiveLoop(for: task)
                return
              }

              if serverMessage.shareReady != nil {
                self.handleServerResponse(serverMessage)
                self.receiveLoop(for: task)
                return
              }

              if serverMessage.ackMessage != nil {
                self.handleServerResponse(serverMessage)
                self.receiveLoop(for: task)
                return
              }
            }

            if let shareRequest = serverMessage.shareRequest {
              self.handleShareRequest(shareRequest)
              self.receiveLoop(for: task)
              return
            }

            if
              serverMessage.errorCode != nil ||
              serverMessage.checkResult != nil ||
              serverMessage.shareReady != nil ||
              serverMessage.ackMessage != nil
            {
              self.handleServerResponse(serverMessage)
              self.receiveLoop(for: task)
              return
            }

#if DEBUG
            if let ack = serverMessage.ackMessage {
              print("WS <- ack \(ack)")
            } else if let checkResult = serverMessage.checkResult {
              let checkResultLabel: String
              switch checkResult.outcome {
              case .confirmed:
                checkResultLabel = "confirmed"
              case .notConfirmed:
                checkResultLabel = "not_confirmed"
              }
              print(
                "WS <- checkResult \(checkResultLabel) \(checkResult.reasonCode)"
              )
            } else if let shareRequest = serverMessage.shareRequest {
              print(
                "WS <- shareRequest fields=\(shareRequest.fields.count)"
              )
            } else if let shareReady = serverMessage.shareReady {
              print(
                "WS <- shareReady fields=\(shareReady.selectedFieldKeys.count)"
              )
            } else if let errorMessage = serverMessage.errorMessage {
              let code = serverMessage.errorCode ?? "unknown"
              print("WS <- error \(code) \(errorMessage)")
            } else {
              print("WS <- message")
            }
#endif
            if let error = serverMessage.errorMessage {
              let code = serverMessage.errorCode ?? "unknown"
#if DEBUG
              print("WebSocket error: \(code) \(error)")
#endif
            }
          }
        case .string(let text):
#if DEBUG
          print("Unexpected WebSocket text: \(text)")
#endif
        @unknown default:
          break
        }
      case .failure(let error):
#if DEBUG
        print("WebSocket receive error: \(error)")
#endif
        if self.consumeExpectedCheckResultClose() {
          return
        }
        self.handleUnexpectedConnectionLoss()
        return
      }
      self.receiveLoop(for: task)
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    guard isCurrentTask(webSocketTask) else {
      return
    }

    if closeCode == .normalClosure || stateQueue.sync(execute: { isClosing }) {
      return
    }

    if consumeExpectedCheckResultClose() {
      return
    }

    handleUnexpectedConnectionLoss()
  }
}
