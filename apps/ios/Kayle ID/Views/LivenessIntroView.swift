import SwiftUI

struct LivenessIntroView: View {
  let onContinue: () -> Void

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .step,
        visual: .systemImage(name: "person.fill.viewfinder", size: 72),
        title: String(localized: "Next, a quick liveness check"),
        subtitle: String(
          localized:
            "Position your face in the frame, then slowly turn your head to the left and right. Make sure your face is well-lit and clearly visible."
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
