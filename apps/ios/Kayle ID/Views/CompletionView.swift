import SwiftUI

struct CompletionView: View {
  let isSuccess: Bool
  let message: String
  var isPrimaryLoading = false
  var isSecondaryDisabled = false
  let primaryButtonTitle: String
  let onPrimaryAction: () -> Void
  let secondaryButtonTitle: String?
  let onSecondaryAction: (() -> Void)?
  var privacyRequestURL: URL? = nil

  var body: some View {
    StepScreen(layout: .centered) {
      StepHero(
        variant: .step,
        visual: .systemImage(
          name: isSuccess ? "checkmark.circle.fill" : "xmark.circle.fill",
          size: 80
        ),
        title: isSuccess
          ? String(localized: "Verification Complete")
          : String(localized: "Verification Failed"),
        subtitle: message,
        visualColor: isSuccess ? .green : .red
      )
    } content: {
      EmptyView()
    } footer: {
      ActionButton(
        style: .primary,
        title: primaryButtonTitle,
        isDisabled: isPrimaryLoading,
        isLoading: isPrimaryLoading,
        loadingTitle: primaryButtonTitle,
        action: onPrimaryAction
      )

      if let secondaryButtonTitle, let onSecondaryAction {
        ActionButton(
          style: .secondary,
          title: secondaryButtonTitle,
          isDisabled: isSecondaryDisabled,
          action: onSecondaryAction
        )
      }

      if let privacyRequestURL {
        Link(destination: privacyRequestURL) {
          Text("Privacy Options")
            .font(.system(.body, weight: .medium))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(.primary)
            .background {
              Capsule()
                .fill(Color(.systemBackground))
            }
            .overlay {
              Capsule()
                .stroke(.primary.opacity(0.2), lineWidth: 1)
            }
        }
      }
    }
  }
}
