import SwiftUI

extension ContentView {
  func stepView(for step: VerificationStep) -> AnyView {
    switch step {
    case .welcome:
      return AnyView(
        WelcomeView(
          onGetStarted: startQRScanning,
          onAbout: {
            isAboutSheetPresented = true
          }
        )
      )
    case .scanning:
      return AnyView(scanningView)
    case .mrz:
      let mrzBackAction: (() -> Void)? = if session.payload == nil {
        goBackFromMRZ
      } else {
        nil
      }
      let mrzCancelAction: (() -> Void)? = if session.payload == nil {
        nil
      } else {
        presentCancelVerificationConfirmation
      }

      return AnyView(
        MRZIntroView(
          onContinue: presentMRZDrawer,
          onBack: mrzBackAction,
          onCancel: mrzCancelAction
        )
      )
    case .rfidCheck:
      return AnyView(
        RFIDCheckView(
          rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription,
          onHasRFID: {
            resetNFCReaderState()
            session.hasRFIDSymbol = true
            hasStartedNFCScan = false
            session.moveToStep(.nfc)
            Task {
              await session.updatePhase(.nfcReading)
            }
          },
          onNoRFID: {
            session.hasRFIDSymbol = false
            session.moveToStep(.rfidUnsupported)
          },
          onBack: goBackFromRFIDCheck
        )
      )
    case .rfidUnsupported:
      return AnyView(
        RFIDUnsupportedView(
          documentName: currentDocumentName,
          documentNameWithArticle: currentDocumentNameWithArticle,
          rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription,
          onTryAnotherDocument: tryAnotherDocument,
          onReturnHome: presentCancelVerificationConfirmation,
          onBack: goBackFromRFIDUnsupported
        )
      )
    case .nfc:
      return AnyView(
        NFCReadingView(
          nfcReader: nfcReader,
          documentName: currentDocumentName,
          uploadProgress: displayedNFCUploadProgress,
          isUploading: isDisplayingNFCUploadUI,
          hasStarted: hasStartedNFCScan,
          onBack: nfcBackAction,
          onStart: startNFCScan,
          onRetryUpload: retryNFCUpload,
          onComplete: uploadNFCResult
        )
      )
    case .livenessIntro:
      return AnyView(LivenessIntroView(onContinue: startLivenessCapture))
    case .liveness:
      return AnyView(LivenessIntroView(onContinue: presentLivenessDrawer))
    case .shareDetails:
      return AnyView(
        ShareDetailsView(
          session: session,
          onSubmit: {
            Task {
              await session.submitShareSelection()
            }
          },
          onCancel: presentCancelVerificationConfirmation
        )
      )
    case .complete:
      return completionStepView
    case .error:
      return AnyView(
        CompletionView(
          isSuccess: false,
          message: session.errorMessage ?? String(localized: "An unexpected error occurred."),
          primaryButtonTitle: String(localized: "Start Again"),
          onPrimaryAction: resetVerificationFlow,
          secondaryButtonTitle: nil,
          onSecondaryAction: nil,
          privacyRequestURL: session.privacyRequestURL
        )
      )
    }
  }

  func stepView(for snapshot: StepRenderSnapshot) -> AnyView {
    switch snapshot.step {
    case .welcome:
      return AnyView(WelcomeView(onGetStarted: {}, onAbout: {}))
    case .scanning:
      return AnyView(
        QRIntroView(
          onContinue: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .mrz:
      return AnyView(
        MRZIntroView(
          onContinue: {},
          onBack: snapshot.showsBackButton ? {} : nil,
          onCancel: snapshot.showsCancelButton ? {} : nil
        )
      )
    case .rfidCheck:
      return AnyView(
        RFIDCheckView(
          rfidSymbolLocationDescription:
            snapshot.documentCopy?.rfidSymbolLocationDescription ??
            defaultRFIDSymbolLocationDescription,
          onHasRFID: {},
          onNoRFID: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .rfidUnsupported:
      return AnyView(
        RFIDUnsupportedView(
          documentName: snapshot.documentCopy?.documentName ?? defaultDocumentName,
          documentNameWithArticle:
            snapshot.documentCopy?.documentNameWithArticle ??
            defaultDocumentNameWithArticle,
          rfidSymbolLocationDescription:
            snapshot.documentCopy?.rfidSymbolLocationDescription ??
            defaultRFIDSymbolLocationDescription,
          onTryAnotherDocument: {},
          onReturnHome: {},
          onBack: snapshot.showsBackButton ? {} : nil
        )
      )
    case .nfc:
      if let nfcSnapshot = snapshot.nfc {
        return AnyView(
          FrozenNFCReadingView(
            snapshot: nfcSnapshot,
            onBack: snapshot.showsBackButton ? {} : nil
          )
        )
      }
      return AnyView(Color.clear)
    case .livenessIntro, .liveness:
      return AnyView(LivenessIntroView(onContinue: {}))
    case .shareDetails:
      if let shareDetailsSnapshot = snapshot.shareDetails {
        return AnyView(FrozenShareDetailsView(snapshot: shareDetailsSnapshot))
      }
      return AnyView(Color.clear)
    case .complete, .error:
      if let completionSnapshot = snapshot.completion {
        return AnyView(
          CompletionView(
            isSuccess: completionSnapshot.isSuccess,
            message: completionSnapshot.message,
            primaryButtonTitle: completionSnapshot.primaryButtonTitle,
            onPrimaryAction: {},
            secondaryButtonTitle: completionSnapshot.secondaryButtonTitle,
            onSecondaryAction: nil,
            privacyRequestURL: completionSnapshot.privacyRequestURL
          )
        )
      }
      return AnyView(Color.clear)
    }
  }

  var scanningView: some View {
    QRIntroView(
      onContinue: presentQRDrawer,
      onBack: scanningBackAction
    )
  }

  var completionStepView: AnyView {
    let secondaryButtonTitle = completionSecondaryButtonTitle
    let secondaryAction: (() -> Void)?

    if secondaryButtonTitle == nil {
      secondaryAction = nil
    } else if let checkResult = session.checkResult,
      isNotConfirmedCheck(checkResult),
      checkResult.retryAllowed
    {
      secondaryAction = presentCancelVerificationConfirmation
    } else {
      secondaryAction = resetVerificationFlow
    }

    return AnyView(
      CompletionView(
        isSuccess: isConfirmedCheck(session.checkResult),
        message: completionMessage,
        isPrimaryLoading:
          isNotConfirmedCheck(session.checkResult) &&
          session.checkResult?.retryAllowed == true &&
          session.isRetryingVerification,
        isSecondaryDisabled: session.isRetryingVerification,
        primaryButtonTitle: completionPrimaryButtonTitle,
        onPrimaryAction: handleCompletionPrimaryAction,
        secondaryButtonTitle: secondaryButtonTitle,
        onSecondaryAction: secondaryAction,
        privacyRequestURL: session.privacyRequestURL
      )
    )
  }

  var currentDocumentCopySnapshot: DocumentCopySnapshot {
    DocumentCopySnapshot(
      documentName: currentDocumentName,
      documentNameWithArticle: currentDocumentNameWithArticle,
      rfidSymbolLocationDescription: currentRFIDSymbolLocationDescription
    )
  }

  var currentDocumentName: String {
    session.mrzResult?.userFacingDocumentName ?? defaultDocumentName
  }

  var currentDocumentNameWithArticle: String {
    session.mrzResult?.userFacingDocumentNameWithArticle ?? defaultDocumentNameWithArticle
  }

  var currentRFIDSymbolLocationDescription: String {
    session.mrzResult?.userFacingRFIDSymbolLocationDescription ??
      defaultRFIDSymbolLocationDescription
  }

  var defaultDocumentName: String {
    String(localized: "document")
  }

  var defaultDocumentNameWithArticle: String {
    String(localized: "a document")
  }

  var defaultRFIDSymbolLocationDescription: String {
    String(localized: "your document")
  }

  var completionMessage: String {
    guard let checkResult = session.checkResult else {
      return String(localized: "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.")
    }

    if isConfirmedCheck(checkResult) {
      return String(localized: "Your identity verification data has been securely transmitted. You can now close this app and return to your browser.")
    }

    if
      isNotConfirmedCheck(checkResult),
      checkResult.retryAllowed,
      let errorMessage = session.errorMessage,
      !errorMessage.isEmpty
    {
      return "\(checkResult.reasonMessage)\n\n\(errorMessage)"
    }

    return checkResult.reasonMessage
  }

  var completionPrimaryButtonTitle: String {
    guard let checkResult = session.checkResult else {
      return String(localized: "Done")
    }

    if isNotConfirmedCheck(checkResult), checkResult.retryAllowed {
      return String(localized: "Retry Verification")
    }

    return String(localized: "Done")
  }

  var completionSecondaryButtonTitle: String? {
    guard let checkResult = session.checkResult else {
      return nil
    }

    return isNotConfirmedCheck(checkResult) && checkResult.retryAllowed ? "Cancel" : nil
  }

  func makeStepRenderSnapshot(for step: VerificationStep) -> StepRenderSnapshot {
    switch step {
    case .welcome:
      return StepRenderSnapshot(step: .welcome)
    case .scanning:
      return StepRenderSnapshot(
        step: .scanning,
        showsBackButton: session.payload == nil
      )
    case .mrz:
      return StepRenderSnapshot(
        step: .mrz,
        showsBackButton: session.payload == nil,
        showsCancelButton: session.payload != nil
      )
    case .rfidCheck:
      return StepRenderSnapshot(
        step: .rfidCheck,
        showsBackButton: true,
        documentCopy: currentDocumentCopySnapshot
      )
    case .rfidUnsupported:
      return StepRenderSnapshot(
        step: .rfidUnsupported,
        showsBackButton: true,
        documentCopy: currentDocumentCopySnapshot
      )
    case .nfc:
      return StepRenderSnapshot(
        step: .nfc,
        showsBackButton: !isDisplayingNFCUploadUI,
        nfc: NFCRenderSnapshot(
          documentName: currentDocumentName,
          uploadProgress: displayedNFCUploadProgress,
          isUploading: isDisplayingNFCUploadUI,
          hasStarted: hasStartedNFCScan,
          errorMessage: nfcReader.errorMessage,
          result: nfcReader.result
        )
      )
    case .livenessIntro:
      return StepRenderSnapshot(step: .livenessIntro)
    case .liveness:
      return StepRenderSnapshot(step: .liveness)
    case .shareDetails:
      return StepRenderSnapshot(
        step: .shareDetails,
        shareDetails: ShareDetailsRenderSnapshot(
          shareRequest: session.shareRequest,
          selectedShareFieldKeys: session.selectedShareFieldKeys,
          shareSelectionErrorMessage: session.shareSelectionErrorMessage,
          isSubmittingShareSelection: session.isSubmittingShareSelection,
          nfcResult: session.nfcResult,
          mrzResult: session.mrzResult
        )
      )
    case .complete:
      return StepRenderSnapshot(
        step: .complete,
        completion: CompletionRenderSnapshot(
          isSuccess: isConfirmedCheck(session.checkResult),
          message: completionMessage,
          primaryButtonTitle: completionPrimaryButtonTitle,
          secondaryButtonTitle: completionSecondaryButtonTitle,
          privacyRequestURL: session.privacyRequestURL
        )
      )
    case .error:
      return StepRenderSnapshot(
        step: .error,
        completion: CompletionRenderSnapshot(
          isSuccess: false,
          message: session.errorMessage ?? String(localized: "An unexpected error occurred."),
          primaryButtonTitle: String(localized: "Start Again"),
          secondaryButtonTitle: nil,
          privacyRequestURL: session.privacyRequestURL
        )
      )
    }
  }
}
