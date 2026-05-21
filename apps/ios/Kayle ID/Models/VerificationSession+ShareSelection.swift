import Foundation

extension VerificationSession {
  func handleShareRequest(_ shareRequest: VerifyShareRequest) {
    self.shareRequest = shareRequest
    selectedShareFieldKeys = defaultSelectedShareFieldKeys(shareRequest)
    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = false
    moveToStep(.shareDetails)
  }

  func isShareFieldSelected(_ key: String) -> Bool {
    selectedShareFieldKeys.contains(key)
  }

  func setShareFieldSelected(_ key: String, isSelected: Bool) {
    guard
      let field = shareRequest?.fields.first(where: { $0.key == key }),
      !isShareFieldSelectionLocked(field)
    else {
      return
    }

    if isSelected {
      selectedShareFieldKeys.insert(key)
      return
    }

    selectedShareFieldKeys.remove(key)
  }

  func canSubmitShareSelection() -> Bool {
    isShareSelectionSubmittable(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
  }

  func canSelectAllAvailableShareFields() -> Bool {
    hasUnselectedOptionalShareFields(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
  }

  func selectAllAvailableShareFields() {
    selectedShareFieldKeys = selectedShareFieldKeysIncludingAllOptionalFields(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )
    shareSelectionErrorMessage = nil
  }

  func submitShareSelection() async {
    guard let shareRequest, let webSocketService else {
      handleError(VerificationError.notInitialized)
      return
    }

    let orderedSelectedFieldKeys = orderedSelectedShareFieldKeys(
      shareRequest: shareRequest,
      selectedShareFieldKeys: selectedShareFieldKeys
    )

    guard !orderedSelectedFieldKeys.isEmpty else {
      shareSelectionErrorMessage = String(
        localized: "Choose at least one verification detail before continuing."
      )
      return
    }

    shareSelectionErrorMessage = nil
    isSubmittingShareSelection = true

    do {
      let response = try await webSocketService.sendShareSelectionAwaitResponse(
        sessionId: shareRequest.sessionId,
        selectedFieldKeys: orderedSelectedFieldKeys
      )

      if let shareReady = response.shareReady {
        selectedShareFieldKeys = Set(shareReady.selectedFieldKeys)
        isSubmittingShareSelection = false
        closeActiveSessionConnection()
        moveToStep(.complete)
        return
      }

      throw VerifyWebSocketError.unexpectedServerResponse(
        describeUnexpectedServerMessage(
          response,
          fallback: String(
            localized: "Unexpected share selection response from the server."
          )
        )
      )
    } catch let socketError as VerifyWebSocketError {
      isSubmittingShareSelection = false

      if case .serverError(_, let message) = socketError {
        shareSelectionErrorMessage = message
        return
      }

      handleError(socketError)
    } catch {
      isSubmittingShareSelection = false
      handleError(error)
    }
  }
}
