import SwiftUI

struct LivenessInstructionPill: View {
  let title: String
  let subtitle: String

  var body: some View {
    VStack(spacing: 6) {
      Text(title)
        .font(.title3.weight(.semibold))
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
      Text(subtitle)
        .font(.subheadline)
        .foregroundStyle(.white.opacity(0.85))
        .multilineTextAlignment(.center)
    }
    .shadow(color: .black.opacity(0.7), radius: 6, x: 0, y: 1)
  }
}

struct LivenessOverlay: View {
  let state: LivenessUIState

  private let cornerRadius: CGFloat = 44

  var body: some View {
    GeometryReader { proxy in
      let frame = proxy.frame(in: .local)
      let centre = CGPoint(x: frame.midX, y: frame.midY)
      let cutoutSize = cutoutSize(for: frame.size)
      let cutoutRect = CGRect(
        x: centre.x - cutoutSize.width / 2,
        y: centre.y - cutoutSize.height / 2,
        width: cutoutSize.width,
        height: cutoutSize.height
      )

      ZStack {
        ZStack {
          Rectangle()
            .fill(.ultraThinMaterial)
            .opacity(0.4)
            .ignoresSafeArea()
          Color.black.opacity(0.22)
            .ignoresSafeArea()
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .frame(width: cutoutRect.width, height: cutoutRect.height)
            .position(x: cutoutRect.midX, y: cutoutRect.midY)
            .blendMode(.destinationOut)
        }
        .compositingGroup()

        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .stroke(
            .white.opacity(0.45),
            style: StrokeStyle(lineWidth: 4)
          )
          .frame(width: cutoutRect.width, height: cutoutRect.height)
          .position(x: cutoutRect.midX, y: cutoutRect.midY)

        LivenessProgressArc(
          progress: state.rightProgress,
          side: .right,
          cornerRadius: cornerRadius
        )
        .stroke(
          arcColour(for: state.rightProgress),
          style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round)
        )
        .frame(width: cutoutRect.width, height: cutoutRect.height)
        .position(x: cutoutRect.midX, y: cutoutRect.midY)
        .animation(.easeOut(duration: 0.12), value: state.rightProgress)

        LivenessProgressArc(
          progress: state.leftProgress,
          side: .left,
          cornerRadius: cornerRadius
        )
        .stroke(
          arcColour(for: state.leftProgress),
          style: StrokeStyle(lineWidth: 12, lineCap: .round, lineJoin: .round)
        )
        .frame(width: cutoutRect.width, height: cutoutRect.height)
        .position(x: cutoutRect.midX, y: cutoutRect.midY)
        .animation(.easeOut(duration: 0.12), value: state.leftProgress)
      }
    }
  }

  private func cutoutSize(for size: CGSize) -> CGSize {
    let width = min(size.width * 0.78, 300)
    let height = width * 1.25
    return CGSize(width: width, height: height)
  }

  private func arcColour(for progress: Double) -> Color {
    if progress >= 1.0 {
      return Color.green
    }
    let normalized = max(0, min(1, progress))
    let red = 1.0 - normalized
    let green = 1.0
    let blue = 1.0 - normalized * 0.9
    return Color(red: red, green: green, blue: blue)
  }
}

private struct LivenessProgressArc: Shape {
  enum Side {
    case left
    case right
  }

  var progress: Double
  let side: Side
  let cornerRadius: CGFloat

  var animatableData: Double {
    get { progress }
    set { progress = newValue }
  }

  func path(in rect: CGRect) -> Path {
    var combined = Path()
    let clamped = max(0.0, min(1.0, progress))
    if clamped <= 0 {
      return combined
    }

    let perimeter = sidePerimeter(in: rect)
    combined.addPath(perimeter.trimmedPath(from: 0, to: clamped * 0.5))
    combined.addPath(perimeter.trimmedPath(from: 1 - clamped * 0.5, to: 1))
    return combined
  }

  private func sidePerimeter(in rect: CGRect) -> Path {
    var path = Path()
    let r = min(cornerRadius, min(rect.width, rect.height) / 2)
    let xSign: CGFloat = side == .left ? -1 : 1

    path.move(to: CGPoint(x: rect.midX, y: rect.minY))

    let topCornerEntry = CGPoint(
      x: rect.midX + xSign * (rect.width / 2 - r),
      y: rect.minY
    )
    path.addLine(to: topCornerEntry)

    let topCornerCentre = CGPoint(
      x: side == .left ? rect.minX + r : rect.maxX - r,
      y: rect.minY + r
    )
    appendCorner(
      to: &path,
      centre: topCornerCentre,
      radius: r,
      startAngle: -.pi / 2,
      sweep: side == .left ? -.pi / 2 : .pi / 2
    )

    let bottomCornerEntry = CGPoint(
      x: side == .left ? rect.minX : rect.maxX,
      y: rect.maxY - r
    )
    path.addLine(to: bottomCornerEntry)

    let bottomCornerCentre = CGPoint(
      x: side == .left ? rect.minX + r : rect.maxX - r,
      y: rect.maxY - r
    )
    appendCorner(
      to: &path,
      centre: bottomCornerCentre,
      radius: r,
      startAngle: side == .left ? .pi : 0,
      sweep: side == .left ? -.pi / 2 : .pi / 2
    )

    path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))

    return path
  }

  private func appendCorner(
    to path: inout Path,
    centre: CGPoint,
    radius: CGFloat,
    startAngle: CGFloat,
    sweep: CGFloat
  ) {
    let steps = 24
    for index in 1...steps {
      let t = CGFloat(index) / CGFloat(steps)
      let angle = startAngle + sweep * t
      let point = CGPoint(
        x: centre.x + radius * cos(angle),
        y: centre.y + radius * sin(angle)
      )
      path.addLine(to: point)
    }
  }
}
