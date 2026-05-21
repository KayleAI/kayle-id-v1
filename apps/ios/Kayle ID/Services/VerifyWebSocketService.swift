import Foundation

final class VerifyWebSocketService: NSObject, URLSessionWebSocketDelegate {
  let requestTimeoutSeconds = 10 * 60.0
  let resourceTimeoutSeconds = 15 * 60.0
  let keepaliveIntervalNs: UInt64 = 20_000_000_000
  let sessionId: String
  let mobileWriteToken: String
  let baseURL: String
  let attestHelloChallenge: Data?
  let onFatalError: ((VerifyWebSocketError) -> Void)?
  let onShareRequest: ((VerifyShareRequest) -> Void)?
  let onActiveAuthChallenge: ((Data) -> Void)?
  let onLivenessChallenge: ((VerifyServerLivenessChallenge) -> Void)?
  let codec = VerifyCapnpCodec()

  var webSocketTask: URLSessionWebSocketTask?
  let stateQueue = DispatchQueue(label: "com.kayle.verify.websocket.state")
  let helloAttestationTimeoutNs: UInt64 = 6_000_000_000
  let sendTimeoutNs: UInt64 = 8_000_000_000
  let helloAckTimeoutNs: UInt64 = 8_000_000_000
  let serverResponseTimeoutNs: UInt64 = 8_000_000_000

  var isClosing = false
  var helloDeviceId: String?
  var helloAppVersion: String?
  var pendingHelloContinuation: CheckedContinuation<Void, Error>?
  var helloTimeoutTask: Task<Void, Never>?
  var pendingServerResponseContinuation: CheckedContinuation<VerifyServerMessage, Error>?
  var pendingServerResponseAllowsErrorMessage = false
  var queuedServerResponses: [VerifyServerMessage] = []
  var serverResponseTimeoutTask: Task<Void, Never>?
  var expectedCheckResultClose = false
  var keepaliveTask: Task<Void, Never>?

  lazy var urlSession: URLSession = {
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = requestTimeoutSeconds
    config.timeoutIntervalForResource = resourceTimeoutSeconds
    config.tlsMinimumSupportedProtocolVersion = .TLSv12
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  init(
    sessionId: String,
    mobileWriteToken: String,
    baseURL: String,
    attestHelloChallenge: Data? = nil,
    onFatalError: ((VerifyWebSocketError) -> Void)? = nil,
    onShareRequest: ((VerifyShareRequest) -> Void)? = nil,
    onActiveAuthChallenge: ((Data) -> Void)? = nil,
    onLivenessChallenge: ((VerifyServerLivenessChallenge) -> Void)? = nil
  ) {
    self.sessionId = sessionId
    self.mobileWriteToken = mobileWriteToken
    self.baseURL = baseURL
    self.attestHelloChallenge = attestHelloChallenge
    self.onFatalError = onFatalError
    self.onShareRequest = onShareRequest
    self.onActiveAuthChallenge = onActiveAuthChallenge
    self.onLivenessChallenge = onLivenessChallenge
    super.init()
  }
}
