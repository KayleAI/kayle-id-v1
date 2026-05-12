import SwiftUI

struct WelcomeView: View {
  let onGetStarted: () -> Void
  let onAbout: () -> Void

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .brand,
        visual: .logo,
        title: String(localized: "Kayle ID"),
        subtitle: String(localized: "Let’s verify your identity in a few quick steps.")
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(
        style: .primary,
        title: String(localized: "Get Started"),
        action: onGetStarted
      )
      ActionButton(
        style: .secondary,
        title: String(localized: "About"),
        action: onAbout
      )
    }
  }
}
