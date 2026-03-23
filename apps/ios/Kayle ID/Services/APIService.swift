import Foundation

/// API service for communicating with the Kayle verification backend.
enum APIService {
  private static let productionBaseURL = "https://api.kayle.id"
  private static let developmentBaseURLKey = "KAYLE_DEV_API_BASE_URL"

  /// Construct the API base URL for the current app environment.
  static func baseURL(from _: String) -> String {
    #if DEBUG
    if let configuredBaseURL = configuredDevelopmentBaseURL() {
      return configuredBaseURL
    }
    #endif

    return productionBaseURL
  }

  @MainActor
  static func fetchHandoffPayload(sessionId: String) async throws -> QRCodePayload {
    guard let url = URL(string: "\(baseURL(from: sessionId))/v1/verify/session/\(sessionId)/handoff")
    else {
      throw APIError.invalidResponse
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    guard
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw APIError.invalidResponse
    }

    guard (200...299).contains(httpResponse.statusCode) else {
      if
        let error = envelope["error"] as? [String: Any],
        let message = error["message"] as? String
      {
        throw APIError.serverError(message)
      }
      throw APIError.httpError(httpResponse.statusCode)
    }

    guard
      let payload = envelope["data"] as? [String: Any],
      let payloadSessionId = payload["session_id"] as? String,
      let attemptId = payload["attempt_id"] as? String,
      let mobileWriteToken = payload["mobile_write_token"] as? String,
      let expiresAtValue = payload["expires_at"] as? String
    else {
      throw APIError.invalidResponse
    }

    guard let expiresAt = parseQRCodePayloadDate(expiresAtValue) else {
      throw APIError.invalidResponse
    }

    return QRCodePayload(
      v: payload["v"] as? Int,
      sessionId: payloadSessionId,
      attemptId: attemptId,
      mobileWriteToken: mobileWriteToken,
      expiresAt: expiresAt
    )
  }

  #if DEBUG
  private static func configuredDevelopmentBaseURL() -> String? {
    let environmentValue = ProcessInfo.processInfo.environment[developmentBaseURLKey]
    let infoValue = Bundle.main.object(forInfoDictionaryKey: developmentBaseURLKey) as? String
    let rawValue = environmentValue ?? infoValue

    guard
      let rawValue,
      let normalizedValue = normalizeBaseURL(rawValue)
    else {
      return nil
    }

    return normalizedValue
  }
  #endif

  private static func normalizeBaseURL(_ rawValue: String) -> String? {
    let trimmedValue = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedValue.isEmpty else {
      return nil
    }

    guard
      let url = URL(string: trimmedValue),
      let scheme = url.scheme?.lowercased(),
      let host = url.host,
      !host.isEmpty,
      scheme == "http" || scheme == "https"
    else {
      return nil
    }

    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = url.port
    return components.string
  }
}

// MARK: - Error Types

enum APIError: LocalizedError {
  case invalidResponse
  case httpError(Int)
  case serverError(String)

  var errorDescription: String? {
    switch self {
    case .invalidResponse:
      return "Invalid server response."
    case .httpError(let code):
      return "Server error (HTTP \(code))."
    case .serverError(let message):
      return message
    }
  }
}
