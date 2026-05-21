import SwiftUI

enum StepScreenLayout {
  case centered
  case topAlignedScrollable
}

enum StepHeroVariant {
  case brand
  case step
}

enum StepHeroVisual {
  case logo
  case systemImage(name: String, size: CGFloat)
}

enum StepScreenMetrics {
  static let outerPadding: CGFloat = 16
  static let contentWidth: CGFloat = 360
  static let sectionSpacing: CGFloat = 20
  static let heroSpacing: CGFloat = 12
  static let actionSpacing: CGFloat = 12
  static let topBarHeight: CGFloat = 28
  static let rowCornerRadius: CGFloat = 20
  static let rowPadding: CGFloat = 16
}

struct StepScreen<Header: View, Content: View, Footer: View>: View {
  let layout: StepScreenLayout
  var onBack: (() -> Void)?
  private let header: Header
  private let content: Content
  private let footer: Footer

  init(
    layout: StepScreenLayout,
    onBack: (() -> Void)? = nil,
    @ViewBuilder header: () -> Header,
    @ViewBuilder content: () -> Content,
    @ViewBuilder footer: () -> Footer
  ) {
    self.layout = layout
    self.onBack = onBack
    self.header = header()
    self.content = content()
    self.footer = footer()
  }

  var body: some View {
    ZStack {
      Color(.systemBackground).ignoresSafeArea()

      switch layout {
      case .centered:
        centeredLayout
      case .topAlignedScrollable:
        topAlignedScrollableLayout
      }
    }
  }

  private var centeredLayout: some View {
    VStack(spacing: StepScreenMetrics.sectionSpacing) {
      if let onBack {
        topBar(action: onBack)
      }

      Spacer(minLength: 0)

      VStack(spacing: StepScreenMetrics.sectionSpacing) {
        header
        content
      }
      .frame(maxWidth: StepScreenMetrics.contentWidth)
      .frame(maxWidth: .infinity)

      Spacer(minLength: 0)

      VStack(spacing: StepScreenMetrics.actionSpacing) {
        footer
      }
      .frame(maxWidth: StepScreenMetrics.contentWidth)
      .frame(maxWidth: .infinity)
    }
    .padding(StepScreenMetrics.outerPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var topAlignedScrollableLayout: some View {
    VStack(spacing: StepScreenMetrics.sectionSpacing) {
      if let onBack {
        topBar(action: onBack)
      }

      header
        .frame(maxWidth: StepScreenMetrics.contentWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)

      ScrollView {
        VStack(alignment: .leading, spacing: StepScreenMetrics.sectionSpacing) {
          content
        }
        .frame(maxWidth: StepScreenMetrics.contentWidth, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, 4)
      }

      VStack(spacing: StepScreenMetrics.actionSpacing) {
        footer
      }
      .frame(maxWidth: StepScreenMetrics.contentWidth)
      .frame(maxWidth: .infinity)
    }
    .padding(StepScreenMetrics.outerPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
  }

  private func topBar(action: @escaping () -> Void) -> some View {
    HStack {
      StepBackButton(action: action)
      Spacer()
    }
    .frame(maxWidth: StepScreenMetrics.contentWidth)
    .frame(maxWidth: .infinity)
    .frame(height: StepScreenMetrics.topBarHeight, alignment: .leading)
  }
}

private struct StepBackButton: View {
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 6) {
        Image(systemName: "chevron.left")
          .font(.system(size: 15, weight: .semibold))

        Text("Back")
          .font(.system(.body, weight: .medium))
      }
      .foregroundStyle(.primary)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Back")
  }
}

struct StepHero: View {
  let variant: StepHeroVariant
  let visual: StepHeroVisual?
  let title: String
  var subtitle: String?
  var visualColor: Color = .primary

  var body: some View {
    VStack(spacing: StepScreenMetrics.heroSpacing) {
      if let visual {
        heroVisual(visual)
      }

      Text(title)
        .font(titleFont)
        .foregroundStyle(.primary)
        .multilineTextAlignment(.center)

      if let subtitle, !subtitle.isEmpty {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.center)
      }
    }
    .frame(maxWidth: .infinity)
  }

  private var titleFont: Font {
    switch variant {
    case .brand:
      return .title2.bold()
    case .step:
      return .title3.bold()
    }
  }

  @ViewBuilder
  private func heroVisual(_ visual: StepHeroVisual) -> some View {
    switch visual {
    case .logo:
      AppLogoBadgeView()
    case let .systemImage(name, size):
      Image(systemName: name)
        .font(.system(size: size))
        .foregroundStyle(visualColor)
    }
  }
}

private struct AppLogoBadgeView: View {
  var body: some View {
    Image("Logo")
      .resizable()
      .scaledToFit()
      .frame(width: 96, height: 96)
      .clipShape(RoundedRectangle(cornerRadius: 20))
      .overlay {
        RoundedRectangle(cornerRadius: 20)
          .stroke(.primary.opacity(0.1), lineWidth: 1)
      }
  }
}
