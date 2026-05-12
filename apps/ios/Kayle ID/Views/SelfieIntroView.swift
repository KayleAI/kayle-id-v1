import SwiftUI

struct SelfieIntroView: View {
  let onContinue: () -> Void

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .step,
        visual: .systemImage(name: "person.crop.circle", size: 72),
        title: String(localized: "Next, take a quick selfie"),
        subtitle: String(
          localized: "We’ll automatically capture three photos. Make sure your face is well lit and clearly visible."
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
    }
  }
}
