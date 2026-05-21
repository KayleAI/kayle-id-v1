nonisolated private enum PublicShareFieldVisibility {
  static let showsKayleHumanId = false
}

nonisolated func defaultSelectedShareFieldKeys(
  _ shareRequest: VerifyShareRequest?
) -> Set<String> {
  guard let shareRequest else {
    return []
  }

  return Set(
    shareRequest.fields.compactMap { field in
      isShareFieldSelectionLocked(field) ? field.key : nil
    }
  )
}

nonisolated func hasUnselectedOptionalShareFields(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Bool {
  optionalShareRequestFields(shareRequest).contains { field in
    !selectedShareFieldKeys.contains(field.key)
  }
}

nonisolated func selectedShareFieldKeysIncludingAllOptionalFields(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Set<String> {
  var nextSelectedShareFieldKeys = selectedShareFieldKeys

  for field in optionalShareRequestFields(shareRequest) {
    nextSelectedShareFieldKeys.insert(field.key)
  }

  return nextSelectedShareFieldKeys
}

nonisolated func orderedSelectedShareFieldKeys(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> [String] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.compactMap { field in
    selectedShareFieldKeys.contains(field.key) || isShareFieldSelectionLocked(field)
      ? field.key
      : nil
  }
}

nonisolated func isShareSelectionSubmittable(
  shareRequest: VerifyShareRequest?,
  selectedShareFieldKeys: Set<String>
) -> Bool {
  guard let shareRequest else {
    return false
  }

  let requiredKeys = shareRequest.fields.compactMap { field in
    field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
      ? field.key
      : nil
  }

  return requiredKeys.allSatisfy(selectedShareFieldKeys.contains)
}

nonisolated func isShareFieldSelectionLocked(_ field: VerifyShareRequestField) -> Bool {
  field.required || isKayleShareField(field.key)
}

nonisolated func isKayleShareField(_ key: String) -> Bool {
  key.hasPrefix("kayle_")
}

nonisolated func isPubliclyVisibleShareField(_ key: String) -> Bool {
  if key == "kayle_human_id" {
    return PublicShareFieldVisibility.showsKayleHumanId
  }

  return true
}

nonisolated func kayleShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    isKayleShareField(field.key)
  }
}

nonisolated func visibleKayleShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  kayleShareRequestFields(shareRequest).filter { field in
    isPubliclyVisibleShareField(field.key)
  }
}

nonisolated func isImplicitAgeGateField(
  _ key: String,
  shareRequest: VerifyShareRequest?
) -> Bool {
  guard parseAgeOverThreshold(key) != nil else {
    return false
  }
  guard let shareRequest else {
    return false
  }
  return shareRequest.fields.contains { field in
    field.key == "date_of_birth" && field.required
  }
}

nonisolated func requiredShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
  }
}

nonisolated func optionalShareRequestFields(
  _ shareRequest: VerifyShareRequest?
) -> [VerifyShareRequestField] {
  guard let shareRequest else {
    return []
  }

  return shareRequest.fields.filter { field in
    !field.required
      && !isKayleShareField(field.key)
      && !isImplicitAgeGateField(field.key, shareRequest: shareRequest)
  }
}
