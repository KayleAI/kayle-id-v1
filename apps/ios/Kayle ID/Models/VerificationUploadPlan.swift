import Foundation

struct DataUploadPlan: Sendable {
  let kind: VerifyDataKind
  let index: Int
  let total: Int
  let chunks: [Data]

  nonisolated init(kind: VerifyDataKind, chunks: [Data], index: Int = 0, total: Int = 1) {
    self.kind = kind
    self.index = index
    self.total = total
    self.chunks = chunks
  }

  nonisolated func request(for chunkIndex: Int) -> VerifyDataUploadRequest {
    VerifyDataUploadRequest(
      kind: kind,
      raw: chunks[chunkIndex],
      index: index,
      total: total,
      chunkIndex: chunkIndex,
      chunkTotal: chunks.count
    )
  }

  nonisolated func acknowledgementKey(for chunkIndex: Int) -> String {
    "\(kind.rawValue)-\(index)-\(chunkIndex)"
  }
}

struct LivenessUploadPlan: Sendable {
  let videoBytes: Data
  let upload: DataUploadPlan

  nonisolated init(videoBytes: Data, upload: DataUploadPlan) {
    self.videoBytes = videoBytes
    self.upload = upload
  }
}
