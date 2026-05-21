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
      exclude: [
        "Assets.xcassets",
        "Info.plist",
        "InfoPlist.xcstrings",
        "Kayle ID.entitlements",
        "Localizable.xcstrings",
        "Main.swift",
        "Models/VerificationErrors.swift",
        "Models/VerificationServerMessageDescription.swift",
        "Models/VerificationSession.swift",
        "Models/VerificationSession+Lifecycle.swift",
        "Models/VerificationSession+Reconnect.swift",
        "Models/VerificationSession+Retry.swift",
        "Models/VerificationSession+ShareSelection.swift",
        "Models/VerificationSession+LivenessUpload.swift",
        "Models/VerificationSession+NFCUpload.swift",
        "Models/VerificationSession+UploadChunks.swift",
        "Models/VerificationSession+UploadState.swift",
        "Models/VerificationSession+WebSocketFactory.swift",
        "Models/VerificationUploadPlan.swift",
        "Services/APIService.swift",
        "Services/AppAttestService.swift",
        "Services/DocumentNFCReader.swift",
        "Services/VerifyCapnpCodec.swift",
        "Services/VerifyWebSocketService+Connection.swift",
        "Services/VerifyWebSocketService+Handshake.swift",
        "Services/VerifyWebSocketService+Receiving.swift",
        "Services/VerifyWebSocketService.swift",
        "Services/VerifyWebSocketService+Sending.swift",
        "Services/VerifyWebSocketTypes.swift",
        "Utilities/CameraPermissionGate.swift",
        "Utilities/MRZOCRViewController.swift",
        "Utilities/PreviewSupport.swift",
        "Utilities/RuntimeIntegrity.swift",
        "Views",
      ],
      sources: [
        "Models/SessionScope.swift",
        "Models/MRZResult.swift",
        "Models/QRCodePayload.swift",
        "Models/VerificationStep.swift",
        "Models/VerifyWebSocketAuthPolicy.swift",
        "Models/VerifyShareFieldDisplayPolicy.swift",
        "Models/VerifyShareRequestPolicy.swift",
        "Services/LivenessNonceStamp.swift",
        "Utilities/LivenessTempFileStore.swift",
        "Utilities/MRZParser.swift",
      ]
    ),
    .testTarget(
      name: "KayleIDModelsTests",
      dependencies: ["KayleIDModels"],
      path: "Kayle IDTests",
      sources: [
        "SessionScopeTests.swift",
        "LivenessNonceStampTests.swift",
        "LivenessTempFileStoreTests.swift",
        "MRZParserTests.swift",
        "QRCodePayloadTests.swift",
        "VerificationStepReconnectTests.swift",
        "VerifyWebSocketAuthPolicyTests.swift",
      ]
    ),
  ]
)
