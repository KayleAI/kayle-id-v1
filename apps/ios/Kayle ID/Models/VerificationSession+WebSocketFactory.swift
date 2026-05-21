import Foundation

extension VerificationSession {
  func makeWebSocketService(
    for payload: QRCodePayload
  ) -> VerifyWebSocketService {
    let baseURL = APIService.baseURL(from: payload.sessionId)
    let sessionId = payload.sessionId
    let attestChallenge = payload.attestHelloChallenge
      .flatMap { Data(base64URLEncodedString: $0) }

    return VerifyWebSocketService(
      sessionId: payload.sessionId,
      mobileWriteToken: payload.mobileWriteToken,
      baseURL: baseURL,
      attestHelloChallenge: attestChallenge,
      onFatalError: { [weak self] socketError in
        Task { @MainActor [weak self] in
          guard let self else { return }
          guard
            shouldHandleSessionScopedEvent(
              currentSessionId: self.payload?.sessionId,
              eventSessionId: sessionId
            )
          else {
            return
          }
          self.handleError(socketError, forSessionId: sessionId)
        }
      },
      onShareRequest: { [weak self] shareRequest in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleSessionScopedEvent(
              currentSessionId: self.payload?.sessionId,
              eventSessionId: sessionId
            )
          else {
            return
          }
          self.handleShareRequest(shareRequest)
        }
      },
      onActiveAuthChallenge: { [weak self] challenge in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleSessionScopedEvent(
              currentSessionId: self.payload?.sessionId,
              eventSessionId: sessionId
            )
          else {
            return
          }
          self.activeAuthChallenge = challenge
        }
      },
      onLivenessChallenge: { [weak self] challenge in
        Task { @MainActor [weak self] in
          guard
            let self,
            shouldHandleSessionScopedEvent(
              currentSessionId: self.payload?.sessionId,
              eventSessionId: sessionId
            )
          else {
            return
          }
          self.livenessChallenge = challenge
        }
      }
    )
  }
}
