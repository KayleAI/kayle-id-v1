import SwiftUI
import UIKit

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
  var flashTrigger: Int?
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
