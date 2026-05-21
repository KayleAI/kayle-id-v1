import SwiftUI

struct RFIDCheckView: View {
  var rfidSymbolLocationDescription = "your document"
  let onHasRFID: () -> Void
  let onNoRFID: () -> Void
  var onBack: (() -> Void)? = nil

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: nil,
        title: String(localized: "Do you see this symbol?")
      )
    } content: {
      VStack(spacing: 10) {
        Image("RFIDSymbol")
          .resizable()
          .scaledToFit()
          .frame(width: 150, height: 100)

        Text("Look for this symbol on \(rfidSymbolLocationDescription).")
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
      }
    } footer: {
      ActionButton(
        style: .primary,
        title: String(localized: "Yes, I see it"),
        action: onHasRFID
      )
      ActionButton(
        style: .secondary,
        title: String(localized: "I don't see it"),
        action: onNoRFID
      )
    }
  }
}
