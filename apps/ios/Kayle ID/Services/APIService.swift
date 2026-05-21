import Foundation

enum APIService {
  private static let productionBaseURL = "https://api.kayle.id"
  private static let productionVerifyBaseURL = "https://verify.kayle.id"
  private static let developmentBaseURLKey = "KAYLE_DEV_API_BASE_URL"

  static func baseURL(from _: String) -> String {
    #if DEBUG
    if let configuredBaseURL = configuredDevelopmentBaseURL() {
      return configuredBaseURL
    }
    #endif

    return productionBaseURL
  }

  static func privacyRequestURL(sessionId: String, cancelToken: String?) -> URL? {
    guard var components = URLComponents(string: productionVerifyBaseURL) else {
      return nil
    }

    components.path = "/privacy/\(sessionId)"
    if let cancelToken {
      components.queryItems = [
        URLQueryItem(name: "cancel_token", value: cancelToken)
      ]
    }
    return components.url
  }

  @MainActor
  static func cancelVerification(sessionId: String, cancelToken: String) async throws {
    guard let url = URL(string: "\(baseURL(from: sessionId))/v1/verify/session/\(sessionId)/cancel")
    else {
      throw APIError.invalidResponse
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(
      withJSONObject: ["cancel_token": cancelToken]
    )

    let (data, response) = try await URLSession.shared.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw APIError.invalidResponse
    }

    if httpResponse.statusCode == 204 {
      return
    }

    guard
      let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      throw APIError.invalidResponse
    }

    if
      let error = envelope["error"] as? [String: Any],
      let message = error["message"] as? String
    {
      throw APIError.serverError(message)
    }

    throw APIError.httpError(httpResponse.statusCode)
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

    // ATS is relaxed app-wide via `NSAllowsArbitraryLoads`, so this gate is
    // the only thing keeping a dev `KAYLE_DEV_API_BASE_URL` from pointing at
    // an arbitrary HTTP host. Limit it to loopback and Tailscale CGNAT
    // (100.64.0.0/10) — the ranges a paired iPhone can actually reach.
    if scheme == "http" && !isAllowedDevelopmentHttpHost(host) {
      return nil
    }

    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = url.port
    return components.string
  }

  private static func isAllowedDevelopmentHttpHost(_ host: String) -> Bool {
    if host == "localhost" || host == "127.0.0.1" {
      return true
    }
    return isTailscaleCGNATAddress(host)
  }

  // Tailscale assigns IPs from the 100.64.0.0/10 CGNAT range (RFC 6598), so a
  // dev box reachable from a paired iPhone over Tailscale will land on
  // 100.64.0.0 – 100.127.255.255. Matching the range lets the host gate
  // accept whatever Tailscale IP the dev machine currently has without
  // requiring a code change every time it rotates.
  private static func isTailscaleCGNATAddress(_ host: String) -> Bool {
    let octets = host.split(separator: ".")
    guard octets.count == 4 else {
      return false
    }

    var values: [Int] = []
    values.reserveCapacity(4)
    for octet in octets {
      guard let value = Int(octet), value >= 0, value <= 255 else {
        return false
      }
      values.append(value)
    }

    return values[0] == 100 && values[1] >= 64 && values[1] <= 127
  }
}

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
