import SwiftUI

@main
struct Main: App {
  @State private var pendingQRCode: String?

  var body: some Scene {
    WindowGroup {
      ContentView(pendingQRCode: $pendingQRCode)
        .preferredColorScheme(.light)
        .onOpenURL { url in
          // Handle kayle-id:// URL scheme
          handleIncomingURL(url)
        }
    }
  }

  private func handleIncomingURL(_ url: URL) {
    guard url.scheme == "kayle-id" else { return }
    pendingQRCode = url.absoluteString
  }
}
