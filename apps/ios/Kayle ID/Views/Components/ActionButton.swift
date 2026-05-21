import SwiftUI

enum ActionButtonStyle {
  case primary
  case secondary
}

struct ActionButton: View {
  let style: ActionButtonStyle
  let title: String
  var isDisabled = false
  var isLoading = false
  var loadingTitle: String?
  let action: () -> Void

  private var isDimmed: Bool {
    isDisabled || isLoading
  }

  private var displayTitle: String {
    if isLoading, let loadingTitle {
      return loadingTitle
    }
    return title
  }

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        if isLoading {
          ProgressView()
            .controlSize(.small)
            .tint(foregroundColor)
        }

        Text(displayTitle)
          .font(.system(.body, weight: .medium))
      }
      .frame(maxWidth: .infinity)
      .padding(.vertical, 14)
      .foregroundStyle(foregroundColor)
      .background {
        Capsule()
          .fill(backgroundColor)
      }
      .overlay {
        Capsule()
          .stroke(borderColor, lineWidth: borderWidth)
      }
      .contentShape(Rectangle())
    }
    .disabled(isDimmed)
    .buttonStyle(.plain)
  }

  private var foregroundColor: Color {
    switch style {
    case .primary:
      return Color(.systemBackground)
    case .secondary:
      return .primary.opacity(isDimmed ? 0.45 : 1)
    }
  }

  private var backgroundColor: Color {
    switch style {
    case .primary:
      return .primary.opacity(isDimmed ? 0.35 : 1)
    case .secondary:
      return Color(.systemBackground)
    }
  }

  private var borderColor: Color {
    switch style {
    case .primary:
      return .clear
    case .secondary:
      return .primary.opacity(0.2)
    }
  }

  private var borderWidth: CGFloat {
    switch style {
    case .primary:
      return 0
    case .secondary:
      return 1
    }
  }
}
