import SwiftUI

struct QRIntroView: View {
  let onContinue: () -> Void
  var onBack: (() -> Void)? = nil

  var body: some View {
    StepScreen(layout: .centered, onBack: onBack) {
      StepHero(
        variant: .step,
        visual: .systemImage(name: "qrcode.viewfinder", size: 72),
        title: "Scan the QR code",
        subtitle: "Use your camera to scan the QR code from your browser and begin verification."
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(style: .primary, title: "Continue", action: onContinue)
    }
  }
}
