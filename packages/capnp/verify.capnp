@0xef7e0b8fbd1f2ab3;

struct ClientHello {
  attemptId @0 :Text;
  mobileWriteToken @1 :Text;
  deviceId @2 :Text;
  appVersion @3 :Text;
  # Base64url-encoded SHA-256 of the attested public key. Empty string when
  # the client has not yet completed App Attest registration; the server
  # rejects with HELLO_ATTEST_KEY_UNKNOWN in that case once the gate is on.
  attestKeyId @4 :Text;
  # CBOR-encoded App Attest assertion { signature, authenticatorData } over
  # SHA-256("attest:hello:" + attemptId + deviceId + appVersion + challenge).
  helloAssertion @5 :Data;
  # Soft-signal bitfield from RuntimeIntegrity: bit 0 = debugger attached,
  # bit 1 = DCAppAttestService swizzled. Server adds bits to riskScore but
  # never gates on this — App Attest carries the load-bearing claim.
  runtimeIntegritySignal @6 :UInt32;
}

struct PhaseUpdate {
  phase @0 :Text;
  error @1 :Text;
  # CBOR-encoded App Attest assertion bound to the NFC-completion artifacts.
  # Populated only when `phase = "nfc_complete"`. clientDataHash covers
  # SHA-256 of every uploaded artifact (DG1/2/14/15?/SOD/CA-transcript?/AA-sig?)
  # plus attemptId and the per-attempt nfc challenge.
  attestAssertion @2 :Data;
}

enum DataKind {
  dg1 @0;
  dg2 @1;
  sod @2;
  selfie @3;
  dg14 @4;
  dg15 @5;
  activeAuth @6;
  chipAuth @7;
}

struct DataPayload {
  kind @0 :DataKind;
  raw @1 :Data;
  index @2 :UInt32;
  total @3 :UInt32;
  chunkIndex @4 :UInt32;
  chunkTotal @5 :UInt32;
}

struct ShareSelection {
  sessionId @0 :Text;
  selectedFieldKeys @1 :List(Text);
}

struct ClientMessage {
  union {
    hello @0 :ClientHello;
    phase @1 :PhaseUpdate;
    data @2 :DataPayload;
    shareSelection @3 :ShareSelection;
  }
}

struct ServerAck {
  message @0 :Text;
}

struct ServerError {
  code @0 :Text;
  message @1 :Text;
}

enum VerdictOutcome {
  accepted @0;
  rejected @1;
}

struct ServerVerdict {
  outcome @0 :VerdictOutcome;
  reasonCode @1 :Text;
  reasonMessage @2 :Text;
  retryAllowed @3 :Bool;
  remainingAttempts @4 :UInt32;
}

struct ShareRequestField {
  key @0 :Text;
  reason @1 :Text;
  required @2 :Bool;
}

struct ShareRequest {
  contractVersion @0 :UInt32;
  sessionId @1 :Text;
  fields @2 :List(ShareRequestField);
}

struct ShareReady {
  sessionId @0 :Text;
  selectedFieldKeys @1 :List(Text);
}

struct ServerActiveAuthChallenge {
  challenge @0 :Data;
}

struct ServerMessage {
  union {
    ack @0 :ServerAck;
    error @1 :ServerError;
    verdict @2 :ServerVerdict;
    shareRequest @3 :ShareRequest;
    shareReady @4 :ShareReady;
    activeAuthChallenge @5 :ServerActiveAuthChallenge;
  }
}
