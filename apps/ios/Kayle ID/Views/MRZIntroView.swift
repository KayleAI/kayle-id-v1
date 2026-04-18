import SwiftUI

struct MRZIntroView: View {
  let onContinue: () -> Void
  var onBack: (() -> Void)? = nil

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: .logo,
        title: "Let's read your ID",
        subtitle: "Use your camera to scan your photo page, then read the chip if it has one."
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(style: .primary, title: "Continue", action: onContinue)
    }
  }
}
