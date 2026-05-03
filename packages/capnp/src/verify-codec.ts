import { Message } from "capnp-es";
import {
  ClientMessage as CapnpClientMessage,
  DataKind as CapnpDataKind,
  ServerMessage as CapnpServerMessage,
  VerdictOutcome as CapnpVerdictOutcome,
} from "../generated/ts/verify.js";

export interface VerifyClientHello {
  appVersion?: string;
  attemptId?: string;
  deviceId?: string;
  mobileWriteToken?: string;
}

export interface VerifyPhaseUpdate {
  error?: string;
  phase?: string;
}

export interface VerifyDataPayload {
  chunkIndex?: number;
  chunkTotal?: number;
  index?: number;
  kind?: number;
  raw?: Uint8Array;
  total?: number;
}

export interface VerifyShareSelection {
  selectedFieldKeys?: string[];
  sessionId?: string;
}

export interface VerifyClientMessage {
  data?: VerifyDataPayload;
  hello?: VerifyClientHello;
  phase?: VerifyPhaseUpdate;
  shareSelection?: VerifyShareSelection;
}

export interface VerifyServerMessage {
  ack?: {
    message: string;
  };
  activeAuthChallenge?: {
    challenge: Uint8Array;
  };
  error?: {
    code: string;
    message: string;
  };
  shareReady?: {
    sessionId: string;
    selectedFieldKeys: string[];
  };
  shareRequest?: {
    contractVersion: number;
    sessionId: string;
    fields: Array<{
      key: string;
      reason: string;
      required: boolean;
    }>;
  };
  verdict?: {
    outcome: "accepted" | "rejected";
    reasonCode: string;
    reasonMessage: string;
    retryAllowed: boolean;
    remainingAttempts: number;
  };
}

export type VerifyServerVerdict = NonNullable<VerifyServerMessage["verdict"]>;
export type VerifyServerActiveAuthChallenge = NonNullable<
  VerifyServerMessage["activeAuthChallenge"]
>;
export type VerifyShareRequest = NonNullable<
  VerifyServerMessage["shareRequest"]
>;
export type VerifyShareReady = NonNullable<VerifyServerMessage["shareReady"]>;

function toVerifyVerdictOutcome(
  outcome:
    | typeof CapnpVerdictOutcome.ACCEPTED
    | typeof CapnpVerdictOutcome.REJECTED
): VerifyServerVerdict["outcome"] {
  return outcome === CapnpVerdictOutcome.ACCEPTED ? "accepted" : "rejected";
}

function toCapnpDataKind(
  kind: number | undefined
): (typeof CapnpDataKind)[keyof typeof CapnpDataKind] {
  switch (kind) {
    case CapnpDataKind.DG2:
      return CapnpDataKind.DG2;
    case CapnpDataKind.SOD:
      return CapnpDataKind.SOD;
    case CapnpDataKind.SELFIE:
      return CapnpDataKind.SELFIE;
    case CapnpDataKind.DG14:
      return CapnpDataKind.DG14;
    case CapnpDataKind.DG15:
      return CapnpDataKind.DG15;
    case CapnpDataKind.ACTIVE_AUTH:
      return CapnpDataKind.ACTIVE_AUTH;
    case CapnpDataKind.CHIP_AUTH:
      return CapnpDataKind.CHIP_AUTH;
    default:
      return CapnpDataKind.DG1;
  }
}

export function encodeServerAck(message: string): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const ack = root._initAck();
  ack.message = message;
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeServerError(code: string, message: string): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const error = root._initError();
  error.code = code;
  error.message = message;
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeServerVerdict(verdict: VerifyServerVerdict): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const next = root._initVerdict();
  next.outcome =
    verdict.outcome === "accepted"
      ? CapnpVerdictOutcome.ACCEPTED
      : CapnpVerdictOutcome.REJECTED;
  next.reasonCode = verdict.reasonCode;
  next.reasonMessage = verdict.reasonMessage;
  next.retryAllowed = verdict.retryAllowed;
  next.remainingAttempts = verdict.remainingAttempts;
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeServerShareRequest(
  shareRequest: VerifyShareRequest
): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const next = root._initShareRequest();
  next.contractVersion = shareRequest.contractVersion;
  next.sessionId = shareRequest.sessionId;
  const fields = next._initFields(shareRequest.fields.length);

  for (const [index, field] of shareRequest.fields.entries()) {
    const item = fields.get(index);
    item.key = field.key;
    item.reason = field.reason;
    item.required = field.required;
  }

  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeServerActiveAuthChallenge(
  challenge: VerifyServerActiveAuthChallenge
): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const next = root._initActiveAuthChallenge();
  const challengeBytes = challenge.challenge ?? new Uint8Array();
  next._initChallenge(challengeBytes.length).copyBuffer(challengeBytes);
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeServerShareReady(
  shareReady: VerifyShareReady
): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpServerMessage);
  const next = root._initShareReady();
  next.sessionId = shareReady.sessionId;
  const selectedFieldKeys = next._initSelectedFieldKeys(
    shareReady.selectedFieldKeys.length
  );

  for (const [index, key] of shareReady.selectedFieldKeys.entries()) {
    selectedFieldKeys.set(index, key);
  }

  return new Uint8Array(packet.toArrayBuffer());
}

export function decodeServerMessage(
  bytes: Uint8Array
): VerifyServerMessage | null {
  try {
    const packet = new Message(bytes, false);
    const root = packet.getRoot(CapnpServerMessage);

    switch (root.which()) {
      case CapnpServerMessage.ACK:
        return {
          ack: {
            message: root.ack.message,
          },
        };
      case CapnpServerMessage.ERROR:
        return {
          error: {
            code: root.error.code,
            message: root.error.message,
          },
        };
      case CapnpServerMessage.VERDICT:
        return {
          verdict: {
            outcome: toVerifyVerdictOutcome(root.verdict.outcome),
            reasonCode: root.verdict.reasonCode,
            reasonMessage: root.verdict.reasonMessage,
            retryAllowed: root.verdict.retryAllowed,
            remainingAttempts: root.verdict.remainingAttempts,
          },
        };
      case CapnpServerMessage.SHARE_REQUEST: {
        const fields = root.shareRequest.fields;
        const decodedFields: VerifyShareRequest["fields"] = [];

        for (let index = 0; index < fields.length; index += 1) {
          const field = fields.get(index);
          decodedFields.push({
            key: field.key,
            reason: field.reason,
            required: field.required,
          });
        }

        return {
          shareRequest: {
            contractVersion: root.shareRequest.contractVersion,
            sessionId: root.shareRequest.sessionId,
            fields: decodedFields,
          },
        };
      }
      case CapnpServerMessage.ACTIVE_AUTH_CHALLENGE:
        return {
          activeAuthChallenge: {
            challenge: new Uint8Array(
              root.activeAuthChallenge.challenge.toUint8Array()
            ),
          },
        };
      case CapnpServerMessage.SHARE_READY: {
        const selectedFieldKeys = root.shareReady.selectedFieldKeys;
        const decodedKeys: string[] = [];

        for (let index = 0; index < selectedFieldKeys.length; index += 1) {
          decodedKeys.push(selectedFieldKeys.get(index));
        }

        return {
          shareReady: {
            sessionId: root.shareReady.sessionId,
            selectedFieldKeys: decodedKeys,
          },
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function encodeClientHello(hello: VerifyClientHello): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpClientMessage);
  const next = root._initHello();
  next.attemptId = hello.attemptId ?? "";
  next.mobileWriteToken = hello.mobileWriteToken ?? "";
  next.deviceId = hello.deviceId ?? "";
  next.appVersion = hello.appVersion ?? "";
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeClientPhase(phase: VerifyPhaseUpdate): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpClientMessage);
  const next = root._initPhase();
  next.phase = phase.phase ?? "";
  next.error = phase.error ?? "";
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeClientData(data: VerifyDataPayload): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpClientMessage);
  const next = root._initData();
  next.kind = toCapnpDataKind(data.kind);
  const raw = data.raw ?? new Uint8Array();
  next._initRaw(raw.length).copyBuffer(raw);
  next.index = data.index ?? 0;
  next.total = data.total ?? 0;
  next.chunkIndex = data.chunkIndex ?? 0;
  next.chunkTotal = data.chunkTotal ?? 0;
  return new Uint8Array(packet.toArrayBuffer());
}

export function encodeClientShareSelection(
  shareSelection: VerifyShareSelection
): Uint8Array {
  const packet = new Message();
  const root = packet.initRoot(CapnpClientMessage);
  const next = root._initShareSelection();
  next.sessionId = shareSelection.sessionId ?? "";
  const selectedFieldKeys = shareSelection.selectedFieldKeys ?? [];
  const list = next._initSelectedFieldKeys(selectedFieldKeys.length);

  for (const [index, key] of selectedFieldKeys.entries()) {
    list.set(index, key);
  }

  return new Uint8Array(packet.toArrayBuffer());
}

export function decodeClientMessage(
  bytes: Uint8Array
): VerifyClientMessage | null {
  try {
    const packet = new Message(bytes, false);
    const root = packet.getRoot(CapnpClientMessage);

    switch (root.which()) {
      case CapnpClientMessage.HELLO:
        return {
          hello: {
            attemptId: root.hello.attemptId,
            mobileWriteToken: root.hello.mobileWriteToken,
            deviceId: root.hello.deviceId,
            appVersion: root.hello.appVersion,
          },
        };
      case CapnpClientMessage.PHASE:
        return {
          phase: {
            phase: root.phase.phase,
            error: root.phase.error,
          },
        };
      case CapnpClientMessage.DATA:
        return {
          data: {
            kind: root.data.kind,
            raw: new Uint8Array(root.data.raw.toUint8Array()),
            index: root.data.index,
            total: root.data.total,
            chunkIndex: root.data.chunkIndex,
            chunkTotal: root.data.chunkTotal,
          },
        };
      case CapnpClientMessage.SHARE_SELECTION: {
        const selectedFieldKeys = root.shareSelection.selectedFieldKeys;
        const decodedKeys: string[] = [];

        for (let index = 0; index < selectedFieldKeys.length; index += 1) {
          decodedKeys.push(selectedFieldKeys.get(index));
        }

        return {
          shareSelection: {
            sessionId: root.shareSelection.sessionId,
            selectedFieldKeys: decodedKeys,
          },
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
