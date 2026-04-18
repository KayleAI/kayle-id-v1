import SwiftUI

struct WelcomeView: View {
  let onGetStarted: () -> Void
  let onAbout: () -> Void

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .brand,
        visual: .logo,
        title: "Kayle ID",
        subtitle: "Let’s verify your identity in a few quick steps."
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(style: .primary, title: "Get Started", action: onGetStarted)
      ActionButton(style: .secondary, title: "About", action: onAbout)
    }
  }
}
