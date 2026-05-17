import Foundation

enum LivenessTempFileStore {
  private static let directoryName = "kayle-liveness"
  private static let filenamePrefix = "liveness-"
  private static let recordingExtension = "mp4"

  static func makeRecordingURL(
    baseDirectory: URL = FileManager.default.temporaryDirectory,
    fileManager: FileManager = .default
  ) throws -> URL {
    try prepareStorage(baseDirectory: baseDirectory, fileManager: fileManager)
    removeOrphanedRecordings(baseDirectory: baseDirectory, fileManager: fileManager)

    return storageDirectory(baseDirectory: baseDirectory)
      .appendingPathComponent("\(filenamePrefix)\(UUID().uuidString)")
      .appendingPathExtension(recordingExtension)
  }

  static func removeOrphanedRecordings(
    baseDirectory: URL = FileManager.default.temporaryDirectory,
    fileManager: FileManager = .default
  ) {
    let roots = [
      baseDirectory,
      storageDirectory(baseDirectory: baseDirectory),
    ]

    for root in roots {
      guard
        let urls = try? fileManager.contentsOfDirectory(
          at: root,
          includingPropertiesForKeys: nil
        )
      else {
        continue
      }

      for url in urls where isManagedRecording(url) {
        try? fileManager.removeItem(at: url)
      }
    }
  }

  static func protectRecording(
    at url: URL,
    fileManager: FileManager = .default
  ) throws {
    try applyCompleteFileProtection(to: url, fileManager: fileManager)
  }

  static func isManagedRecording(_ url: URL) -> Bool {
    url.lastPathComponent.hasPrefix(filenamePrefix)
      && url.pathExtension == recordingExtension
  }

  private static func prepareStorage(
    baseDirectory: URL,
    fileManager: FileManager
  ) throws {
    let directory = storageDirectory(baseDirectory: baseDirectory)
    try fileManager.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )
    try applyCompleteFileProtection(to: directory, fileManager: fileManager)
  }

  private static func storageDirectory(baseDirectory: URL) -> URL {
    baseDirectory.appendingPathComponent(directoryName, isDirectory: true)
  }

  private static func applyCompleteFileProtection(
    to url: URL,
    fileManager: FileManager
  ) throws {
#if os(iOS)
    try fileManager.setAttributes(
      [.protectionKey: FileProtectionType.complete],
      ofItemAtPath: url.path
    )
#else
    _ = url
    _ = fileManager
#endif
  }
}
