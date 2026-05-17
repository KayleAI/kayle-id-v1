import SwiftUI

@main
struct Main: App {
  @State private var pendingQRCode: String?

  init() {
    LivenessTempFileStore.removeOrphanedRecordings()
  }

  var body: some Scene {
    WindowGroup {
      ContentView(pendingQRCode: $pendingQRCode)
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
