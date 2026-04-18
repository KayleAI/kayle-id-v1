import SwiftUI

private enum AppAbout {
  static let appName = "Kayle ID"
  static let privacyPolicyURL = URL(string: "https://kayle.id/privacy")
  static let termsOfServiceURL = URL(string: "https://kayle.id/terms")

  static func versionDescription(bundle: Bundle = .main) -> String {
    let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String

    switch (
      version?.trimmingCharacters(in: .whitespacesAndNewlines),
      build?.trimmingCharacters(in: .whitespacesAndNewlines)
    ) {
    case let (version?, build?)
      where !version.isEmpty && !build.isEmpty && version != build:
      return "Version \(version) (\(build))"
    case let (version?, _) where !version.isEmpty:
      return "Version \(version)"
    case let (_, build?) where !build.isEmpty:
      return "Build \(build)"
    default:
      return "Version unavailable"
    }
  }
}

struct AboutSheetView: View {
  @Environment(\.dismiss) private var dismiss

  private let versionDescription = AppAbout.versionDescription()

  var body: some View {
    NavigationStack {
      StepScreen(layout: .topAlignedScrollable) {
        StepHero(
          variant: .brand,
          visual: .logo,
          title: AppAbout.appName,
          subtitle: versionDescription
        )
        .padding(.top, 8)
      } content: {
        VStack(alignment: .leading, spacing: 12) {
          AboutLinkRow(
            title: "Terms of Service",
            subtitle: "Terms for using Kayle ID and its identity verification features.",
            destination: AppAbout.termsOfServiceURL
          )

          AboutLinkRow(
            title: "Privacy Policy",
            subtitle: "How Kayle ID collects, uses, and protects your information.",
            destination: AppAbout.privacyPolicyURL
          )
        }
      } footer: {
        EmptyView()
      }
      .toolbar {
        ToolbarItem(placement: .principal) {
          Text("About")
            .font(.system(.body, weight: .semibold))
            .foregroundStyle(.black)
        }

        ToolbarItem(placement: .topBarTrailing) {
          Button("Done") {
            dismiss()
          }
          .font(.system(.body, weight: .medium))
          .foregroundStyle(.black)
        }
      }
    }
    .presentationDragIndicator(.visible)
  }
}

private struct AboutLinkRow: View {
  let title: String
  let subtitle: String
  let destination: URL?

  var body: some View {
    Group {
      if let destination {
        Link(destination: destination) {
          rowContent
        }
      } else {
        rowContent
      }
    }
    .buttonStyle(.plain)
  }

  private var rowContent: some View {
    SurfaceRow(title: title, subtitle: subtitle) {
      Image(systemName: destination == nil ? "exclamationmark.circle" : "arrow.up.right")
        .font(.system(size: 16, weight: .semibold))
        .foregroundStyle(.black.opacity(0.5))
    }
  }
}
