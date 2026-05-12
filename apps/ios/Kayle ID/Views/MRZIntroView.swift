import SwiftUI

struct MRZIntroView: View {
  let onContinue: () -> Void
  var onBack: (() -> Void)? = nil
  var onCancel: (() -> Void)? = nil

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: .logo,
        title: String(localized: "Let's read your ID"),
        subtitle: String(
          localized: "Use your camera to scan the printed code on your document, then read the chip if it has one."
        )
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(
        style: .primary,
        title: String(localized: "Continue"),
        action: onContinue
      )

      if let onCancel {
        ActionButton(
          style: .secondary,
          title: String(localized: "Cancel"),
          action: onCancel
        )
      }
    }
  }
}
