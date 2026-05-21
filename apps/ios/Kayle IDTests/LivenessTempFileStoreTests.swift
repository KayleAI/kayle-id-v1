import Foundation
@testable import KayleIDModels
import XCTest

final class LivenessTempFileStoreTests: XCTestCase {
  func testMakeRecordingURLCleansManagedRecordings() throws {
    let root = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }

    let legacyRecording = root.appendingPathComponent("liveness-old.mp4")
    let unrelatedFile = root.appendingPathComponent("profile-photo.mp4")
    let managedDirectory = root.appendingPathComponent(
      "kayle-liveness",
      isDirectory: true
    )
    let managedRecording = managedDirectory
      .appendingPathComponent("liveness-stale")
      .appendingPathExtension("mp4")

    try FileManager.default.createDirectory(
      at: managedDirectory,
      withIntermediateDirectories: true
    )
    _ = FileManager.default.createFile(
      atPath: legacyRecording.path,
      contents: Data()
    )
    _ = FileManager.default.createFile(
      atPath: unrelatedFile.path,
      contents: Data()
    )
    _ = FileManager.default.createFile(
      atPath: managedRecording.path,
      contents: Data()
    )

    let recordingURL = try LivenessTempFileStore.makeRecordingURL(
      baseDirectory: root
    )

    XCTAssertEqual(recordingURL.deletingLastPathComponent(), managedDirectory)
    XCTAssertTrue(LivenessTempFileStore.isManagedRecording(recordingURL))
    XCTAssertFalse(FileManager.default.fileExists(atPath: legacyRecording.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: managedRecording.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: unrelatedFile.path))
  }

  func testRemoveOrphanedRecordingsLeavesNonLivenessFiles() throws {
    let root = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: root) }

    let livenessVideo = root.appendingPathComponent("liveness-delete.mp4")
    let livenessText = root.appendingPathComponent("liveness-keep.txt")
    let otherVideo = root.appendingPathComponent("other.mp4")

    _ = FileManager.default.createFile(
      atPath: livenessVideo.path,
      contents: Data()
    )
    _ = FileManager.default.createFile(
      atPath: livenessText.path,
      contents: Data()
    )
    _ = FileManager.default.createFile(atPath: otherVideo.path, contents: Data())

    LivenessTempFileStore.removeOrphanedRecordings(baseDirectory: root)

    XCTAssertFalse(FileManager.default.fileExists(atPath: livenessVideo.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: livenessText.path))
    XCTAssertTrue(FileManager.default.fileExists(atPath: otherVideo.path))
  }

  private func makeTemporaryDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("kayle-liveness-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(
      at: url,
      withIntermediateDirectories: true
    )
    return url
  }
}
