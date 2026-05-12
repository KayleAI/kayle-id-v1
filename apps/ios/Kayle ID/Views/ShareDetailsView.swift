import SwiftUI

struct ShareDetailsView: View {
  @ObservedObject var session: VerificationSession

  let onSubmit: () -> Void
  let onCancel: () -> Void

  @State private var isShareAllConfirmationPresented = false

  private var kayleFields: [VerifyShareRequestField] {
    visibleKayleShareRequestFields(session.shareRequest)
  }

  private var requiredFields: [VerifyShareRequestField] {
    requiredShareRequestFields(session.shareRequest)
  }

  private var optionalFields: [VerifyShareRequestField] {
    optionalShareRequestFields(session.shareRequest)
  }

  var body: some View {
    StepScreen(layout: .topAlignedScrollable) {
      Text("Choose what to share")
        .font(.title3).bold()
        .foregroundStyle(.primary)
    } content: {
      LazyVStack(alignment: .leading, spacing: 20) {
        shareFieldSection(
          title: String(localized: "Security Details"),
          description: String(
            localized:
              "These identifiers are always included to protect services from abuse."
          ),
          fields: kayleFields
        )

        shareFieldSection(
          title: String(localized: "Required Details"),
          description: String(
            localized:
              "These details are required and will be shared if you continue."
          ),
          fields: requiredFields
        )

        shareFieldSection(
          title: String(localized: "Optional Details"),
          description: String(
            localized: "You can optionally choose to share these details."
          ),
          fields: optionalFields
        )

        if session.isSubmittingShareSelection {
          LoadingStatusRow(
            message: String(localized: "Submitting your selection…")
          )
        }

        if let errorMessage = session.shareSelectionErrorMessage {
          Text(errorMessage)
            .font(.subheadline)
            .foregroundStyle(.red)
        }
      }
    } footer: {
      if !optionalFields.isEmpty && session.canSelectAllAvailableShareFields() {
        ActionButton(
          style: .secondary,
          title: String(localized: "Share all details"),
          isDisabled: session.isSubmittingShareSelection
        ) {
          isShareAllConfirmationPresented = true
        }
      }

      ActionButton(
        style: .primary,
        title: String(localized: "Continue"),
        isDisabled: !session.canSubmitShareSelection(),
        isLoading: session.isSubmittingShareSelection,
        loadingTitle: String(localized: "Submitting...")
      ) {
        onSubmit()
      }

      ActionButton(
        style: .secondary,
        title: String(localized: "Cancel"),
        action: onCancel
      )
    }
    .confirmationDialog(
      "Share all details?",
      isPresented: $isShareAllConfirmationPresented,
      titleVisibility: .visible
    ) {
      Button("Share all details") {
        session.selectAllAvailableShareFields()
        onSubmit()
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(shareAllConfirmationMessage)
    }
  }

  private var unselectedOptionalFieldCount: Int {
    optionalFields.reduce(into: 0) { count, field in
      if !session.isShareFieldSelected(field.key) {
        count += 1
      }
    }
  }

  private var shareAllConfirmationMessage: String {
    if unselectedOptionalFieldCount == 1 {
      return String(
        localized:
          "This will also select 1 optional detail. Required and security details are already included."
      )
    }
    return String(
      localized:
        "This will also select \(unselectedOptionalFieldCount) optional details. Required and security details are already included."
    )
  }

  private func shareFieldRow(_ field: VerifyShareRequestField) -> some View {
    SurfaceRow(
      title: displayNameForShareField(
        field.key,
        previewContext: sharePreviewContext
      ),
      subtitle: shareFieldDetailText(field, previewContext: sharePreviewContext),
      minHeight: 0
    ) {
      Toggle(
        "",
        isOn: Binding(
          get: {
            session.isShareFieldSelected(field.key)
          },
          set: { isSelected in
            session.setShareFieldSelected(field.key, isSelected: isSelected)
          }
        )
      )
      .labelsHidden()
      .tint(.green)
      .disabled(isShareFieldSelectionLocked(field))
    }
  }

  private var sharePreviewContext: VerifySharePreviewContext? {
    if session.nfcResult == nil && session.mrzResult == nil {
      return nil
    }

    return VerifySharePreviewContext(
      birthDate: nonEmptySharePreviewValue(
        session.nfcResult?.dateOfBirth ?? session.mrzResult?.birthDateYYMMDD
      ),
      documentNumber: nonEmptySharePreviewValue(
        session.nfcResult?.documentNumber ?? session.mrzResult?.documentNumber
      ),
      documentType: nonEmptySharePreviewValue(
        session.nfcResult?.documentType ?? session.mrzResult?.documentType
      ),
      expiryDate: nonEmptySharePreviewValue(
        session.nfcResult?.expiryDate ?? session.mrzResult?.expiryDateYYMMDD
      ),
      givenNames: nonEmptySharePreviewValue(
        session.nfcResult?.firstName ?? session.mrzResult?.givenNames
      ),
      issuingCountry: nonEmptySharePreviewValue(
        session.mrzResult?.issuingCountry ?? session.nfcResult?.issuingAuthority
      ),
      nationality: nonEmptySharePreviewValue(
        session.nfcResult?.nationality ?? session.mrzResult?.nationality
      ),
      optionalData: nonEmptySharePreviewValue(session.mrzResult?.optionalData),
      sex: nonEmptySharePreviewValue(
        session.nfcResult?.gender ?? session.mrzResult?.sex
      ),
      surname: nonEmptySharePreviewValue(
        session.nfcResult?.lastName ?? session.mrzResult?.surnames
      )
    )
  }

  private func nonEmptySharePreviewValue(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) else {
      return nil
    }

    return trimmed.isEmpty ? nil : trimmed
  }

  @ViewBuilder
  private func shareFieldSection(
    title: String,
    description: String,
    fields: [VerifyShareRequestField]
  ) -> some View {
    if !fields.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(.headline)
            .foregroundStyle(.primary)

          Text(description)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }

        LazyVStack(spacing: 12) {
          ForEach(fields) { field in
            shareFieldRow(field)
          }
        }
      }
    }
  }
}
