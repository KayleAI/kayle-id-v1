import Capnp
import Foundation

@_silgen_name("verify_build_hello")
nonisolated private func verify_build_hello(
  _ builder: UnsafeMutableRawPointer?,
  _ sessionId: UnsafePointer<CChar>?,
  _ mobileWriteToken: UnsafePointer<CChar>?,
  _ deviceId: UnsafePointer<CChar>?,
  _ appVersion: UnsafePointer<CChar>?,
  _ attestKeyId: UnsafePointer<CChar>?,
  _ helloAssertion: UnsafePointer<UInt8>?,
  _ helloAssertionSize: Int,
  _ runtimeIntegritySignal: UInt32
) -> Int32

@_silgen_name("verify_build_phase")
nonisolated private func verify_build_phase(
  _ builder: UnsafeMutableRawPointer?,
  _ phase: UnsafePointer<CChar>?,
  _ error: UnsafePointer<CChar>?,
  _ attestAssertion: UnsafePointer<UInt8>?,
  _ attestAssertionSize: Int
) -> Int32

@_silgen_name("verify_build_data")
nonisolated private func verify_build_data(
  _ builder: UnsafeMutableRawPointer?,
  _ dataKind: Int32,
  _ raw: UnsafePointer<UInt8>?,
  _ rawSize: Int,
  _ index: UInt32,
  _ total: UInt32,
  _ chunkIndex: UInt32,
  _ chunkTotal: UInt32
) -> Int32

@_silgen_name("verify_build_share_selection")
nonisolated private func verify_build_share_selection(
  _ builder: UnsafeMutableRawPointer?,
  _ sessionId: UnsafePointer<CChar>?,
  _ selectedFieldKeys: UnsafeMutablePointer<UnsafePointer<CChar>?>?,
  _ selectedFieldKeyCount: Int
) -> Int32

@_silgen_name("verify_server_message_kind")
nonisolated private func verify_server_message_kind(_ reader: UnsafeMutableRawPointer?) -> Int32

@_silgen_name("verify_server_message_get_ack")
nonisolated private func verify_server_message_get_ack(
  _ reader: UnsafeMutableRawPointer?,
  _ outMessage: UnsafeMutablePointer<CChar>?,
  _ outMessageSize: Int
) -> Int32

@_silgen_name("verify_server_message_get_error")
nonisolated private func verify_server_message_get_error(
  _ reader: UnsafeMutableRawPointer?,
  _ outCode: UnsafeMutablePointer<CChar>?,
  _ outCodeSize: Int,
  _ outMessage: UnsafeMutablePointer<CChar>?,
  _ outMessageSize: Int
) -> Int32

@_silgen_name("verify_server_message_get_check_result")
nonisolated private func verify_server_message_get_check_result(
  _ reader: UnsafeMutableRawPointer?,
  _ outOutcome: UnsafeMutablePointer<Int32>?,
  _ outReasonCode: UnsafeMutablePointer<CChar>?,
  _ outReasonCodeSize: Int,
  _ outReasonMessage: UnsafeMutablePointer<CChar>?,
  _ outReasonMessageSize: Int,
  _ outRetryAllowed: UnsafeMutablePointer<Int32>?,
  _ outFailedCheck: UnsafeMutablePointer<Int32>?,
  _ outRemainingNfcRetries: UnsafeMutablePointer<UInt32>?,
  _ outRemainingLivenessRetries: UnsafeMutablePointer<UInt32>?
) -> Int32

@_silgen_name("verify_server_message_get_share_request")
nonisolated private func verify_server_message_get_share_request(
  _ reader: UnsafeMutableRawPointer?,
  _ outContractVersion: UnsafeMutablePointer<UInt32>?,
  _ outSessionId: UnsafeMutablePointer<CChar>?,
  _ outSessionIdSize: Int,
  _ outFieldCount: UnsafeMutablePointer<UInt32>?
) -> Int32

@_silgen_name("verify_server_message_get_share_request_field")
nonisolated private func verify_server_message_get_share_request_field(
  _ reader: UnsafeMutableRawPointer?,
  _ fieldIndex: UInt32,
  _ outKey: UnsafeMutablePointer<CChar>?,
  _ outKeySize: Int,
  _ outReason: UnsafeMutablePointer<CChar>?,
  _ outReasonSize: Int,
  _ outRequired: UnsafeMutablePointer<Int32>?
) -> Int32

@_silgen_name("verify_server_message_get_share_ready")
nonisolated private func verify_server_message_get_share_ready(
  _ reader: UnsafeMutableRawPointer?,
  _ outSessionId: UnsafeMutablePointer<CChar>?,
  _ outSessionIdSize: Int,
  _ outFieldCount: UnsafeMutablePointer<UInt32>?
) -> Int32

@_silgen_name("verify_server_message_get_share_ready_field")
nonisolated private func verify_server_message_get_share_ready_field(
  _ reader: UnsafeMutableRawPointer?,
  _ fieldIndex: UInt32,
  _ outKey: UnsafeMutablePointer<CChar>?,
  _ outKeySize: Int
) -> Int32

@_silgen_name("verify_server_message_get_active_auth_challenge")
nonisolated private func verify_server_message_get_active_auth_challenge(
  _ reader: UnsafeMutableRawPointer?,
  _ outChallenge: UnsafeMutablePointer<UInt8>?,
  _ outChallengeSize: Int,
  _ outChallengeLength: UnsafeMutablePointer<Int>?
) -> Int32

@_silgen_name("verify_server_message_get_liveness_challenge")
nonisolated private func verify_server_message_get_liveness_challenge(
  _ reader: UnsafeMutableRawPointer?,
  _ outMaxDurationMs: UnsafeMutablePointer<UInt32>?,
  _ outChallengeNonce: UnsafeMutablePointer<UInt8>?,
  _ outChallengeNonceSize: Int,
  _ outChallengeNonceLength: UnsafeMutablePointer<Int>?
) -> Int32

enum VerifyServerMessageKind: Int32 {
  case none = 0
  case ack = 1
  case error = 2
  case checkResult = 3
  case shareRequest = 4
  case shareReady = 5
  case activeAuthChallenge = 6
  case livenessChallenge = 7
}

struct VerifyServerMessage {
  let ackMessage: String?
  let errorCode: String?
  let errorMessage: String?
  let checkResult: VerifyServerCheckResult?
  let shareRequest: VerifyShareRequest?
  let shareReady: VerifyShareReady?
  let activeAuthChallenge: Data?
  let livenessChallenge: VerifyServerLivenessChallenge?

  nonisolated init(
    ackMessage: String? = nil,
    errorCode: String? = nil,
    errorMessage: String? = nil,
    checkResult: VerifyServerCheckResult? = nil,
    shareRequest: VerifyShareRequest? = nil,
    shareReady: VerifyShareReady? = nil,
    activeAuthChallenge: Data? = nil,
    livenessChallenge: VerifyServerLivenessChallenge? = nil
  ) {
    self.ackMessage = ackMessage
    self.errorCode = errorCode
    self.errorMessage = errorMessage
    self.checkResult = checkResult
    self.shareRequest = shareRequest
    self.shareReady = shareReady
    self.activeAuthChallenge = activeAuthChallenge
    self.livenessChallenge = livenessChallenge
  }
}

final class VerifyCapnpCodec {
  nonisolated func encodeHello(
    sessionId: String,
    mobileWriteToken: String,
    deviceId: String?,
    appVersion: String,
    attestKeyId: String,
    helloAssertion: Data,
    runtimeIntegritySignal: UInt32
  ) -> Data? {
    guard let builder = CapnpMessageBuilder() else {
      return nil
    }

    let result: Int32 = helloAssertion.withUnsafeBytes { assertionBuffer -> Int32 in
      let assertionPtr = assertionBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self)
      let assertionSize = helloAssertion.count

      return sessionId.withCString { sessionCString in
        mobileWriteToken.withCString { tokenCString in
          appVersion.withCString { appCString in
            attestKeyId.withCString { keyIdCString in
              let invokeWithDeviceId: (UnsafePointer<CChar>?) -> Int32 = { deviceCString in
                verify_build_hello(
                  builder.opaque,
                  sessionCString,
                  tokenCString,
                  deviceCString,
                  appCString,
                  keyIdCString,
                  assertionPtr,
                  assertionSize,
                  runtimeIntegritySignal
                )
              }

              if let deviceId {
                return deviceId.withCString { deviceCString in
                  invokeWithDeviceId(deviceCString)
                }
              }
              return invokeWithDeviceId(nil)
            }
          }
        }
      }
    }

    guard result == 1 else {
      return nil
    }

    return builder.toBytes()
  }

  nonisolated func encodePhase(
    phase: String,
    error: String?,
    attestAssertion: Data
  ) -> Data? {
    guard let builder = CapnpMessageBuilder() else {
      return nil
    }

    let result: Int32 = attestAssertion.withUnsafeBytes { assertionBuffer -> Int32 in
      let assertionPtr = assertionBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self)
      let assertionSize = attestAssertion.count

      return phase.withCString { phaseCString in
        if let error {
          return error.withCString { errorCString in
            verify_build_phase(
              builder.opaque,
              phaseCString,
              errorCString,
              assertionPtr,
              assertionSize
            )
          }
        }
        return verify_build_phase(
          builder.opaque,
          phaseCString,
          nil,
          assertionPtr,
          assertionSize
        )
      }
    }

    guard result == 1 else {
      return nil
    }

    return builder.toBytes()
  }

  nonisolated func encodeData(
    kind: VerifyDataKind,
    raw: Data,
    index: Int?,
    total: Int?,
    chunkIndex: Int?,
    chunkTotal: Int?
  ) -> Data? {
    guard let builder = CapnpMessageBuilder() else {
      return nil
    }

    let idx = UInt32(index ?? 0)
    let tot = UInt32(total ?? 0)
    let chunkIdx = UInt32(chunkIndex ?? 0)
    let chunkTot = UInt32(chunkTotal ?? 0)

    let result = raw.withUnsafeBytes { rawBuffer -> Int32 in
      guard let base = rawBuffer.baseAddress else { return 0 }
      let ptr = base.assumingMemoryBound(to: UInt8.self)
      return verify_build_data(
        builder.opaque,
        Int32(kind.rawValue),
        ptr,
        raw.count,
        idx,
        tot,
        chunkIdx,
        chunkTot
      )
    }

    guard result == 1 else {
      return nil
    }

    return builder.toBytes()
  }

  nonisolated func encodeShareSelection(
    sessionId: String,
    selectedFieldKeys: [String]
  ) -> Data? {
    guard let builder = CapnpMessageBuilder() else {
      return nil
    }

    let result = sessionId.withCString { sessionCString in
      let mutableFieldKeyPointers: [UnsafeMutablePointer<CChar>?] = selectedFieldKeys.map {
        strdup($0)
      }
      defer {
        for pointer in mutableFieldKeyPointers {
          if let pointer {
            free(pointer)
          }
        }
      }

      let fieldKeyPointers: [UnsafePointer<CChar>?] = mutableFieldKeyPointers.map {
        pointer in
        if let pointer {
          return UnsafePointer(pointer)
        }
        return nil
      }

      return fieldKeyPointers.withUnsafeBufferPointer { buffer in
        let mutableBase = UnsafeMutablePointer(mutating: buffer.baseAddress)
        return verify_build_share_selection(
          builder.opaque,
          sessionCString,
          mutableBase,
          selectedFieldKeys.count
        )
      }
    }

    guard result == 1 else {
      return nil
    }

    return builder.toBytes()
  }

  nonisolated func decodeServerMessage(_ data: Data) -> VerifyServerMessage? {
    guard let reader = CapnpMessageReader(data: data, format: .unpacked) else {
      return nil
    }

    let kind = VerifyServerMessageKind(rawValue: verify_server_message_kind(reader.opaque)) ?? .none
    switch kind {
    case .ack:
      var buffer = [CChar](repeating: 0, count: 256)
      let ok = verify_server_message_get_ack(reader.opaque, &buffer, buffer.count)
      if ok == 1 {
        return VerifyServerMessage(
          ackMessage: String(cString: buffer),
          errorCode: nil,
          errorMessage: nil,
          checkResult: nil,
          shareRequest: nil,
          shareReady: nil
        )
      }
      return VerifyServerMessage(
        ackMessage: nil,
        errorCode: nil,
        errorMessage: nil,
        checkResult: nil,
        shareRequest: nil,
        shareReady: nil
      )
    case .error:
      var codeBuffer = [CChar](repeating: 0, count: 128)
      var messageBuffer = [CChar](repeating: 0, count: 256)
      let ok = verify_server_message_get_error(
        reader.opaque,
        &codeBuffer,
        codeBuffer.count,
        &messageBuffer,
        messageBuffer.count
      )
      if ok == 1 {
        return VerifyServerMessage(
          ackMessage: nil,
          errorCode: String(cString: codeBuffer),
          errorMessage: String(cString: messageBuffer),
          checkResult: nil,
          shareRequest: nil,
          shareReady: nil
        )
      }
      return VerifyServerMessage(
        ackMessage: nil,
        errorCode: nil,
        errorMessage: nil,
        checkResult: nil,
        shareRequest: nil,
        shareReady: nil
      )
    case .checkResult:
      var outcome: Int32 = -1
      var retryAllowed: Int32 = 0
      var failedCheck: Int32 = Int32(VerifyCheckKind.none.rawValue)
      var remainingNfcRetries: UInt32 = 0
      var remainingLivenessRetries: UInt32 = 0
      var reasonCodeBuffer = [CChar](repeating: 0, count: 128)
      var reasonMessageBuffer = [CChar](repeating: 0, count: 256)
      let ok = verify_server_message_get_check_result(
        reader.opaque,
        &outcome,
        &reasonCodeBuffer,
        reasonCodeBuffer.count,
        &reasonMessageBuffer,
        reasonMessageBuffer.count,
        &retryAllowed,
        &failedCheck,
        &remainingNfcRetries,
        &remainingLivenessRetries
      )
      if ok == 1 {
        let checkOutcome: VerifyCheckOutcome = outcome == 0 ? .confirmed : .notConfirmed
        let kind = VerifyCheckKind(rawValue: failedCheck) ?? .none
        return VerifyServerMessage(
          ackMessage: nil,
          errorCode: nil,
          errorMessage: nil,
          checkResult: VerifyServerCheckResult(
            outcome: checkOutcome,
            reasonCode: String(cString: reasonCodeBuffer),
            reasonMessage: String(cString: reasonMessageBuffer),
            retryAllowed: retryAllowed == 1,
            failedCheck: kind,
            remainingNfcRetries: Int(remainingNfcRetries),
            remainingLivenessRetries: Int(remainingLivenessRetries)
          ),
          shareRequest: nil,
          shareReady: nil
        )
      }
      return VerifyServerMessage(
        ackMessage: nil,
        errorCode: nil,
        errorMessage: nil,
        checkResult: nil,
        shareRequest: nil,
        shareReady: nil
      )
    case .shareRequest:
      var contractVersion: UInt32 = 0
      var fieldCount: UInt32 = 0
      var sessionIdBuffer = [CChar](repeating: 0, count: 256)
      let ok = verify_server_message_get_share_request(
        reader.opaque,
        &contractVersion,
        &sessionIdBuffer,
        sessionIdBuffer.count,
        &fieldCount
      )

      guard ok == 1 else {
        return VerifyServerMessage(
          ackMessage: nil,
          errorCode: nil,
          errorMessage: nil,
          checkResult: nil,
          shareRequest: nil,
          shareReady: nil
        )
      }

      var fields: [VerifyShareRequestField] = []
      fields.reserveCapacity(Int(fieldCount))

      for fieldIndex in 0..<fieldCount {
        var keyBuffer = [CChar](repeating: 0, count: 128)
        var reasonBuffer = [CChar](repeating: 0, count: 256)
        var required: Int32 = 0
        let fieldOk = verify_server_message_get_share_request_field(
          reader.opaque,
          fieldIndex,
          &keyBuffer,
          keyBuffer.count,
          &reasonBuffer,
          reasonBuffer.count,
          &required
        )

        guard fieldOk == 1 else {
          return VerifyServerMessage(
            ackMessage: nil,
            errorCode: nil,
            errorMessage: nil,
            checkResult: nil,
            shareRequest: nil,
            shareReady: nil
          )
        }

        fields.append(
          VerifyShareRequestField(
            key: String(cString: keyBuffer),
            reason: String(cString: reasonBuffer),
            required: required == 1
          )
        )
      }

      return VerifyServerMessage(
        ackMessage: nil,
        errorCode: nil,
        errorMessage: nil,
        checkResult: nil,
        shareRequest: VerifyShareRequest(
          contractVersion: Int(contractVersion),
          sessionId: String(cString: sessionIdBuffer),
          fields: fields
        ),
        shareReady: nil
      )
    case .shareReady:
      var fieldCount: UInt32 = 0
      var sessionIdBuffer = [CChar](repeating: 0, count: 256)
      let ok = verify_server_message_get_share_ready(
        reader.opaque,
        &sessionIdBuffer,
        sessionIdBuffer.count,
        &fieldCount
      )

      guard ok == 1 else {
        return VerifyServerMessage(
          ackMessage: nil,
          errorCode: nil,
          errorMessage: nil,
          checkResult: nil,
          shareRequest: nil,
          shareReady: nil
        )
      }

      var selectedFieldKeys: [String] = []
      selectedFieldKeys.reserveCapacity(Int(fieldCount))

      for fieldIndex in 0..<fieldCount {
        var keyBuffer = [CChar](repeating: 0, count: 128)
        let fieldOk = verify_server_message_get_share_ready_field(
          reader.opaque,
          fieldIndex,
          &keyBuffer,
          keyBuffer.count
        )

        guard fieldOk == 1 else {
          return VerifyServerMessage(
            ackMessage: nil,
            errorCode: nil,
            errorMessage: nil,
            checkResult: nil,
            shareRequest: nil,
            shareReady: nil
          )
        }

        selectedFieldKeys.append(String(cString: keyBuffer))
      }

      return VerifyServerMessage(
        ackMessage: nil,
        errorCode: nil,
        errorMessage: nil,
        checkResult: nil,
        shareRequest: nil,
        shareReady: VerifyShareReady(
          sessionId: String(cString: sessionIdBuffer),
          selectedFieldKeys: selectedFieldKeys
        )
      )
    case .activeAuthChallenge:
      let bufferSize = 64
      var buffer = [UInt8](repeating: 0, count: bufferSize)
      var length: Int = 0
      let ok = verify_server_message_get_active_auth_challenge(
        reader.opaque,
        &buffer,
        bufferSize,
        &length
      )

      guard ok == 1, length > 0, length <= bufferSize else {
        return VerifyServerMessage()
      }

      return VerifyServerMessage(
        activeAuthChallenge: Data(buffer.prefix(length))
      )
    case .livenessChallenge:
      var maxDurationMs: UInt32 = 0
      let nonceCapacity = 32
      var nonceBuffer = [UInt8](repeating: 0, count: nonceCapacity)
      var nonceLength: Int = 0

      let ok = verify_server_message_get_liveness_challenge(
        reader.opaque,
        &maxDurationMs,
        &nonceBuffer,
        nonceCapacity,
        &nonceLength
      )

      guard ok == 1 else {
        return VerifyServerMessage()
      }

      let nonce: Data = nonceLength > 0 && nonceLength <= nonceCapacity
        ? Data(nonceBuffer.prefix(nonceLength))
        : Data()

      return VerifyServerMessage(
        livenessChallenge: VerifyServerLivenessChallenge(
          maxDurationMs: maxDurationMs,
          challengeNonce: nonce
        )
      )
    case .none:
      return nil
    }
  }
}
