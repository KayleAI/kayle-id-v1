import SwiftUI

/// Standalone NFC reading view - can be used in App Clips or main app.
struct NFCReadingView: View {
  @ObservedObject var nfcReader: DocumentNFCReader
  var documentName = "document"
  let uploadProgress: Double
  let isUploading: Bool
  let hasStarted: Bool
  var onBack: (() -> Void)? = nil
  let onStart: () -> Void
  let onComplete: (DocumentReadResult) -> Void

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: .systemImage(name: "wave.3.right.circle.fill", size: 72),
        title: primaryStatusText,
        subtitle: secondaryStatusText
      )
    } content: {
      VStack(alignment: .center, spacing: 10) {
        if let error = nfcReader.errorMessage {
          Text(error)
            .foregroundStyle(.red)
            .multilineTextAlignment(.center)
            .padding(.top, 8)
        }

        if isUploading {
          StatusProgressBar(progress: uploadProgress)
            .padding(.top, 16)
            .padding(.horizontal, 32)

          let percentText = "\(Int((uploadProgress * 100).rounded()))%"
          Text(String(localized: "\(percentText) uploaded"))
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    } footer: {
      if !isUploading {
        ActionButton(
          style: .primary,
          title: nfcReader.errorMessage == nil
            ? String(localized: "Start Scanning")
            : String(localized: "Try Again"),
          action: onStart
        )
      }
    }
    .onChange(of: nfcReader.result) { result in
      if let result {
        onComplete(result)
      }
    }
  }

  private var primaryStatusText: String {
    if isUploading {
      return String(localized: "Uploading your \(documentName) securely")
    }

    return String(localized: "Keep your iPhone close to your \(documentName).")
  }

  private var secondaryStatusText: String {
    if isUploading {
      return String(
        localized: "Keep this screen open while we finish the secure transfer."
      )
    }

    if hasStarted {
      return String(
        localized:
          "Follow the NFC prompt and hold the top of your iPhone against the chip."
      )
    }

    return String(
      localized:
        "When you're ready, tap Start Scanning and follow the NFC prompt."
    )
  }
}
