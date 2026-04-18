import SwiftUI

struct RFIDUnsupportedView: View {
  var documentName = "document"
  var documentNameWithArticle = "a document"
  var rfidSymbolLocationDescription = "the cover or photo page of your document"
  let onTryAnotherDocument: () -> Void
  let onReturnHome: () -> Void
  var onBack: (() -> Void)? = nil

  var body: some View {
    ViewThatFits(in: .vertical) {
      screen(layout: .centered)
      screen(layout: .topAlignedScrollable)
    }
  }

  private func screen(layout: StepScreenLayout) -> some View {
    StepScreen(layout: layout, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: .systemImage(name: "wave.3.right.slash", size: 72),
        title: "This \(documentName) doesn't appear to support NFC",
        subtitle: "Kayle ID needs \(documentNameWithArticle) with the RFID symbol on \(rfidSymbolLocationDescription) to continue on iPhone."
      )
    } content: {
      VStack(spacing: 10) {
        Image("RFIDSymbol")
          .resizable()
          .scaledToFit()
          .frame(width: 150, height: 100)

        Text("If you have another supported \(documentName), you can scan that instead.")
          .font(.subheadline)
          .foregroundStyle(.black.opacity(0.6))
          .multilineTextAlignment(.center)
          .padding(.horizontal, 32)
      }
      .frame(maxWidth: .infinity)
    } footer: {
      ActionButton(
        style: .primary,
        title: "Try Another Document",
        action: onTryAnotherDocument
      )

      ActionButton(style: .secondary, title: "Cancel", action: onReturnHome)
    }
  }
}
