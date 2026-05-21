import SwiftUI

struct SurfaceRow<Accessory: View>: View {
  let title: String
  var subtitle: String?
  var minHeight: CGFloat = 56
  private let accessory: Accessory

  init(
    title: String,
    subtitle: String? = nil,
    minHeight: CGFloat = 56,
    @ViewBuilder accessory: () -> Accessory
  ) {
    self.title = title
    self.subtitle = subtitle
    self.minHeight = minHeight
    self.accessory = accessory()
  }

  var body: some View {
    HStack(alignment: .center, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.headline)
          .foregroundStyle(.primary)
          .fixedSize(horizontal: false, vertical: true)

        if let subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }
      }

      Spacer(minLength: 12)

      accessory
    }
    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
    .padding(StepScreenMetrics.rowPadding)
    .background(Color(.secondarySystemBackground))
    .clipShape(
      RoundedRectangle(
        cornerRadius: StepScreenMetrics.rowCornerRadius,
        style: .continuous
      )
    )
    .contentShape(Rectangle())
  }
}

extension SurfaceRow where Accessory == EmptyView {
  init(
    title: String,
    subtitle: String? = nil,
    minHeight: CGFloat = 56
  ) {
    self.init(title: title, subtitle: subtitle, minHeight: minHeight) {
      EmptyView()
    }
  }
}

enum LoadingStatusTone {
  case dark
  case light
}

struct LoadingStatusRow: View {
  let message: String
  var tone: LoadingStatusTone = .dark

  var body: some View {
    HStack(spacing: 10) {
      ProgressView()
        .progressViewStyle(.circular)
        .tint(tintColor)

      Text(message)
        .font(.subheadline)
        .foregroundStyle(textColor)
    }
  }

  private var tintColor: Color {
    switch tone {
    case .dark:
      return .primary
    case .light:
      return .white
    }
  }

  private var textColor: Color {
    switch tone {
    case .dark:
      return .primary.opacity(0.7)
    case .light:
      return .white
    }
  }
}

struct BlockingLoadingOverlay: View {
  let message: String
  var tone: LoadingStatusTone = .light
  var backgroundOpacity: CGFloat = 0.45

  var body: some View {
    ZStack {
      Color.black.opacity(backgroundOpacity)
        .ignoresSafeArea()

      LoadingStatusRow(message: message, tone: tone)
        .padding(24)
    }
  }
}

struct StatusProgressBar: View {
  let progress: Double

  var body: some View {
    GeometryReader { geometry in
      let clampedProgress = min(max(progress, 0), 1)

      ZStack(alignment: .leading) {
        Capsule()
          .fill(.primary.opacity(0.1))

        Capsule()
          .fill(.primary)
          .frame(width: geometry.size.width * clampedProgress)
      }
    }
    .frame(height: 6)
    .animation(.easeInOut(duration: 0.2), value: progress)
  }
}
