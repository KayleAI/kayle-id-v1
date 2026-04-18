import SwiftUI

/// Standalone RFID check view - can be used in App Clips or main app.
/// NFC is required for Kayle ID, so documents without RFID symbol are not supported.
struct RFIDCheckView: View {
  var rfidSymbolLocationDescription = "the cover or photo page of your document"
  let onHasRFID: () -> Void
  let onNoRFID: () -> Void
  var onBack: (() -> Void)? = nil

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: nil,
        title: "Do you see this symbol?"
      )
    } content: {
      VStack(spacing: 10) {
        Image("RFIDSymbol")
          .resizable()
          .scaledToFit()
          .frame(width: 150, height: 100)

        Text("Look for this symbol on \(rfidSymbolLocationDescription).")
          .font(.subheadline)
          .foregroundStyle(.black.opacity(0.6))
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
      }
    } footer: {
      ActionButton(style: .primary, title: "Yes, I see it", action: onHasRFID)
      ActionButton(style: .secondary, title: "I don't see it", action: onNoRFID)
    }
  }
}
