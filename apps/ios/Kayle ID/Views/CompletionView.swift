import SwiftUI

struct CompletionView: View {
  let isSuccess: Bool
  let message: String
  let primaryButtonTitle: String
  let onPrimaryAction: () -> Void
  let secondaryButtonTitle: String?
  let onSecondaryAction: (() -> Void)?

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .step,
        visual: .systemImage(
          name: isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill",
          size: 80
        ),
        title: isSuccess ? "Verification Complete" : "Verification Failed",
        subtitle: message,
        visualColor: isSuccess ? .green : .red
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(style: .primary, title: primaryButtonTitle, action: onPrimaryAction)

      if let secondaryButtonTitle, let onSecondaryAction {
        ActionButton(style: .secondary, title: secondaryButtonTitle, action: onSecondaryAction)
      }
    }
  }
}
