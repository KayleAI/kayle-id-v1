// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "KayleIDModelTests",
  platforms: [
    .iOS(.v16),
    .macOS(.v14),
  ],
  products: [
    .library(
      name: "KayleIDModels",
      targets: ["KayleIDModels"]
    ),
  ],
  targets: [
    .target(
      name: "KayleIDModels",
      path: "Kayle ID",
      sources: [
        "Models/AttemptScope.swift",
        "Models/MRZResult.swift",
        "Models/QRCodePayload.swift",
        "Models/VerificationStep.swift",
        "Models/VerifyWebSocketAuthPolicy.swift",
        "Services/LivenessNonceStamp.swift",
        "Utilities/MRZParser.swift",
      ]
    ),
    .testTarget(
      name: "KayleIDModelsTests",
      dependencies: ["KayleIDModels"],
      path: "Kayle IDTests",
      sources: [
        "AttemptScopeTests.swift",
        "LivenessNonceStampTests.swift",
        "MRZParserTests.swift",
        "QRCodePayloadTests.swift",
        "VerificationStepReconnectTests.swift",
        "VerifyWebSocketAuthPolicyTests.swift",
      ]
    ),
  ]
)
