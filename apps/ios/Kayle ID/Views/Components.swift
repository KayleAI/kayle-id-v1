import SwiftUI
import UIKit

enum ActionButtonStyle {
  case primary
  case secondary
}

struct ActionButton: View {
  let style: ActionButtonStyle
  let title: String
  var isDisabled = false
  var isLoading = false
  var loadingTitle: String? = nil
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
      return .white
    case .secondary:
      return .black.opacity(isDimmed ? 0.45 : 1)
    }
  }

  private var backgroundColor: Color {
    switch style {
    case .primary:
      return Color.black.opacity(isDimmed ? 0.35 : 1)
    case .secondary:
      return .white
    }
  }

  private var borderColor: Color {
    switch style {
    case .primary:
      return .clear
    case .secondary:
      return Color.black.opacity(0.2)
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

private enum StepScreenMetrics {
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
  var onBack: (() -> Void)? = nil
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
      Color.white.ignoresSafeArea()

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
      .foregroundStyle(.black)
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
  var subtitle: String? = nil
  var visualColor: Color = .black

  var body: some View {
    VStack(spacing: StepScreenMetrics.heroSpacing) {
      if let visual {
        heroVisual(visual)
      }

      Text(title)
        .font(titleFont)
        .foregroundStyle(.black)
        .multilineTextAlignment(.center)

      if let subtitle, !subtitle.isEmpty {
        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.black.opacity(0.6))
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
          .stroke(Color.black.opacity(0.1), lineWidth: 1)
      }
  }
}

struct SurfaceRow<Accessory: View>: View {
  let title: String
  var subtitle: String? = nil
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
          .foregroundStyle(.black)
          .fixedSize(horizontal: false, vertical: true)

        if let subtitle, !subtitle.isEmpty {
          Text(subtitle)
            .font(.subheadline)
            .foregroundStyle(.black.opacity(0.6))
            .fixedSize(horizontal: false, vertical: true)
        }
      }

      Spacer(minLength: 12)

      accessory
    }
    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
    .padding(StepScreenMetrics.rowPadding)
    .background(Color.black.opacity(0.03))
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
      return .black
    case .light:
      return .white
    }
  }

  private var textColor: Color {
    switch tone {
    case .dark:
      return .black.opacity(0.7)
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
          .fill(Color.black.opacity(0.1))

        Capsule()
          .fill(Color.black)
          .frame(width: geometry.size.width * clampedProgress)
      }
    }
    .frame(height: 6)
    .animation(.easeInOut(duration: 0.2), value: progress)
  }
}

enum CameraDrawerMetrics {
  static let instructionBottomPadding: CGFloat = 100
}

enum ScannerCutoutShape {
  case centeredSquare(size: CGFloat, cornerRadius: CGFloat)
  case centeredRectangle(
    width: CGFloat,
    height: CGFloat,
    cornerRadius: CGFloat,
    verticalOffset: CGFloat
  )
  case topSafeAreaRectangle(
    horizontalInset: CGFloat,
    topInset: CGFloat,
    aspectRatio: CGFloat,
    cornerRadius: CGFloat
  )

  fileprivate var cornerRadius: CGFloat {
    switch self {
    case let .centeredSquare(_, cornerRadius):
      return cornerRadius
    case let .centeredRectangle(_, _, cornerRadius, _):
      return cornerRadius
    case let .topSafeAreaRectangle(_, _, _, cornerRadius):
      return cornerRadius
    }
  }

  fileprivate func rect(
    in size: CGSize,
    safeAreaInsets: EdgeInsets,
    windowSafeAreaInsets: UIEdgeInsets
  ) -> CGRect {
    switch self {
    case let .centeredSquare(cutoutSize, _):
      return CGRect(
        x: (size.width - cutoutSize) / 2,
        y: (size.height - cutoutSize) / 2,
        width: cutoutSize,
        height: cutoutSize
      )
    case let .centeredRectangle(width, height, _, verticalOffset):
      return CGRect(
        x: (size.width - width) / 2,
        y: (size.height - height) / 2 + verticalOffset,
        width: width,
        height: height
      )
    case let .topSafeAreaRectangle(horizontalInset, topInset, aspectRatio, _):
      let safeTop = max(safeAreaInsets.top, windowSafeAreaInsets.top)
      let safeLeading = max(safeAreaInsets.leading, windowSafeAreaInsets.left)
      let safeTrailing = max(safeAreaInsets.trailing, windowSafeAreaInsets.right)
      let safeWidth = size.width - safeLeading - safeTrailing
      let width = max(0, safeWidth - horizontalInset * 2)
      let height = max(0, width * aspectRatio)

      return CGRect(
        x: (size.width - width) / 2,
        y: safeTop + topInset,
        width: width,
        height: height
      )
    }
  }
}

struct ScannerOverlayView<Accessory: View>: View {
  let cutout: ScannerCutoutShape
  let title: String
  let subtitle: String
  var borderColor: Color = .white
  var borderWidth: CGFloat = 4
  var overlayOpacity: CGFloat = 0.6
  var instructionHorizontalPadding: CGFloat = 24
  var instructionBottomPadding: CGFloat = 24
  var flashTrigger: Int? = nil
  private let accessory: Accessory

  init(
    cutout: ScannerCutoutShape,
    title: String,
    subtitle: String,
    borderColor: Color = .white,
    borderWidth: CGFloat = 4,
    overlayOpacity: CGFloat = 0.6,
    instructionHorizontalPadding: CGFloat = 24,
    instructionBottomPadding: CGFloat = 24,
    flashTrigger: Int? = nil,
    @ViewBuilder accessory: () -> Accessory
  ) {
    self.cutout = cutout
    self.title = title
    self.subtitle = subtitle
    self.borderColor = borderColor
    self.borderWidth = borderWidth
    self.overlayOpacity = overlayOpacity
    self.instructionHorizontalPadding = instructionHorizontalPadding
    self.instructionBottomPadding = instructionBottomPadding
    self.flashTrigger = flashTrigger
    self.accessory = accessory()
  }

  var body: some View {
    GeometryReader { geometry in
      let cutoutRect = cutout.rect(
        in: geometry.size,
        safeAreaInsets: geometry.safeAreaInsets,
        windowSafeAreaInsets: windowSafeAreaInsets
      )

      ZStack {
        Color.black.opacity(overlayOpacity)

        RoundedRectangle(cornerRadius: cutout.cornerRadius)
          .frame(width: cutoutRect.width, height: cutoutRect.height)
          .position(x: cutoutRect.midX, y: cutoutRect.midY)
          .blendMode(.destinationOut)
      }
      .compositingGroup()

      RoundedRectangle(cornerRadius: cutout.cornerRadius)
        .stroke(borderColor, lineWidth: borderWidth)
        .frame(width: cutoutRect.width, height: cutoutRect.height)
        .position(x: cutoutRect.midX, y: cutoutRect.midY)

      if let flashTrigger, flashTrigger > 0 {
        Color.white
          .opacity(0.3)
          .ignoresSafeArea()
          .animation(.easeOut(duration: 0.1), value: flashTrigger)
      }

      CameraInstructionOverlay(
        title: title,
        subtitle: subtitle,
        horizontalPadding: instructionHorizontalPadding,
        bottomPadding: instructionBottomPadding
      ) {
        accessory
      }
    }
    .ignoresSafeArea()
  }

  private var windowSafeAreaInsets: UIEdgeInsets {
    guard
      let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
      let window = scene.windows.first(where: { $0.isKeyWindow })
    else {
      return .zero
    }

    return window.safeAreaInsets
  }
}

extension ScannerOverlayView where Accessory == EmptyView {
  init(
    cutout: ScannerCutoutShape,
    title: String,
    subtitle: String,
    borderColor: Color = .white,
    borderWidth: CGFloat = 4,
    overlayOpacity: CGFloat = 0.6,
    instructionHorizontalPadding: CGFloat = 24,
    instructionBottomPadding: CGFloat = 24,
    flashTrigger: Int? = nil
  ) {
    self.init(
      cutout: cutout,
      title: title,
      subtitle: subtitle,
      borderColor: borderColor,
      borderWidth: borderWidth,
      overlayOpacity: overlayOpacity,
      instructionHorizontalPadding: instructionHorizontalPadding,
      instructionBottomPadding: instructionBottomPadding,
      flashTrigger: flashTrigger
    ) {
      EmptyView()
    }
  }
}

private struct CameraInstructionOverlay<Accessory: View>: View {
  let title: String
  let subtitle: String
  let horizontalPadding: CGFloat
  let bottomPadding: CGFloat
  private let accessory: Accessory

  init(
    title: String,
    subtitle: String,
    horizontalPadding: CGFloat,
    bottomPadding: CGFloat,
    @ViewBuilder accessory: () -> Accessory
  ) {
    self.title = title
    self.subtitle = subtitle
    self.horizontalPadding = horizontalPadding
    self.bottomPadding = bottomPadding
    self.accessory = accessory()
  }

  var body: some View {
    VStack {
      Spacer()

      VStack(spacing: 8) {
        Text(title)
          .font(.headline)
          .foregroundStyle(.white)
          .multilineTextAlignment(.center)

        Text(subtitle)
          .font(.subheadline)
          .foregroundStyle(.white.opacity(0.85))
          .multilineTextAlignment(.center)

        accessory
      }
      .frame(maxWidth: .infinity)
      .padding(.horizontal, horizontalPadding)
      .padding(.bottom, bottomPadding)
    }
    .frame(maxWidth: .infinity)
  }
}
