import SwiftUI

enum CameraCaptureDrawer: String, Identifiable {
  case qr
  case mrz
  case liveness

  var id: String {
    rawValue
  }
}

struct NFCRenderSnapshot {
  let documentName: String
  let uploadProgress: Double
  let isUploading: Bool
  let hasStarted: Bool
  let errorMessage: String?
  let result: DocumentReadResult?
}

struct DocumentCopySnapshot {
  let documentName: String
  let documentNameWithArticle: String
  let rfidSymbolLocationDescription: String
}

struct ShareDetailsRenderSnapshot {
  let shareRequest: VerifyShareRequest?
  let selectedShareFieldKeys: Set<String>
  let shareSelectionErrorMessage: String?
  let isSubmittingShareSelection: Bool
  let nfcResult: DocumentReadResult?
  let mrzResult: MRZResult?
}

struct CompletionRenderSnapshot {
  let isSuccess: Bool
  let message: String
  let primaryButtonTitle: String
  let secondaryButtonTitle: String?
  let privacyRequestURL: URL?
}

struct StepRenderSnapshot: Identifiable {
  let id = UUID()
  let step: VerificationStep
  var showsBackButton = false
  var showsCancelButton = false
  var documentCopy: DocumentCopySnapshot?
  var nfc: NFCRenderSnapshot?
  var shareDetails: ShareDetailsRenderSnapshot?
  var completion: CompletionRenderSnapshot?
}

@MainActor
struct FrozenNFCReadingView: View {
  let snapshot: NFCRenderSnapshot
  var onBack: (() -> Void)?

  var body: some View {
    NFCReadingView(
      nfcReader: snapshotReader,
      documentName: snapshot.documentName,
      uploadProgress: snapshot.uploadProgress,
      isUploading: snapshot.isUploading,
      hasStarted: snapshot.hasStarted,
      onBack: onBack,
      onStart: {},
      onRetryUpload: {},
      onComplete: { _ in }
    )
    .allowsHitTesting(false)
  }

  private var snapshotReader: DocumentNFCReader {
    let reader = DocumentNFCReader()
    reader.errorMessage = snapshot.errorMessage
    reader.result = snapshot.result
    return reader
  }
}

@MainActor
struct FrozenShareDetailsView: View {
  let snapshot: ShareDetailsRenderSnapshot

  var body: some View {
    ShareDetailsView(session: snapshotSession, onSubmit: {}, onCancel: {})
      .allowsHitTesting(false)
  }

  private var snapshotSession: VerificationSession {
    let session = VerificationSession()
    session.shareRequest = snapshot.shareRequest
    session.selectedShareFieldKeys = snapshot.selectedShareFieldKeys
    session.shareSelectionErrorMessage = snapshot.shareSelectionErrorMessage
    session.isSubmittingShareSelection = snapshot.isSubmittingShareSelection
    session.nfcResult = snapshot.nfcResult
    session.mrzResult = snapshot.mrzResult
    return session
  }
}
