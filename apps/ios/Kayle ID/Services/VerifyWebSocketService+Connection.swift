import Foundation

extension VerifyWebSocketService {
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

  func isCurrentTask(_ task: URLSessionWebSocketTask) -> Bool {
    stateQueue.sync {
      webSocketTask === task
    }
  }

  func startKeepalive() {
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

  func handleUnexpectedConnectionLoss() {
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

  func closeAfterSendFailure() {
    stateQueue.sync {
      isClosing = true
      expectedCheckResultClose = false
    }
    stopKeepalive()
    closeSocket()
    resolvePendingHello(.failure(.connectionClosed))
    resolvePendingServerResponse(.failure(.connectionClosed))
  }

  func isConnectionLossError(_ error: Error) -> Bool {
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

  private func stopKeepalive() {
    keepaliveTask?.cancel()
    keepaliveTask = nil
  }
}
