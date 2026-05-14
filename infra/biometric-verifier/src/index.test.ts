import { expect, test } from "bun:test";
import {
  BIOMETRIC_VERIFIER_AUTH_HEADER,
  BIOMETRIC_VERIFIER_DG2_FIELD,
  BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES,
  BIOMETRIC_VERIFIER_VIDEO_FIELD,
  createBiometricVerifierRequestFormData,
} from "@kayle-id/config/biometric-verifier";
import {
  createDg2Artifact,
  loadVerifyFixtureBytes,
} from "../../../apps/api/tests/helpers/verify-artifacts";
import { createBiometricVerifierWorker } from "./worker";

type TestBiometricVerifierBindings = Partial<BiometricVerifierBindings> & {
  BIOMETRIC_VERIFIER_SECRET?: string;
};

function createExecutionContext(): ExecutionContext {
  return {
    exports: {} as ExecutionContext["exports"],
    passThroughOnException() {
      return;
    },
    props: undefined,
    waitUntil() {
      return;
    },
  };
}

function createWorkerRequest(
  input: string,
  init?: RequestInit
): Request<unknown, IncomingRequestCfProperties<unknown>> {
  return new Request(input, init) as Request<
    unknown,
    IncomingRequestCfProperties<unknown>
  >;
}

function createBindings(
  bindings: TestBiometricVerifierBindings = {}
): BiometricVerifierBindings {
  return bindings as BiometricVerifierBindings;
}

function buildValidPayloadParams(
  portraitBytes: Uint8Array,
  videoBytes: Uint8Array
) {
  return {
    dg2Image: createDg2Artifact({
      imageData: portraitBytes,
      imageFormat: "jpeg",
      wrapWithEfTag: true,
    }),
    video: videoBytes,
  };
}

test("biometric verifier worker forwards liveness payload to the container", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const videoBytes = new Uint8Array(8192).fill(7);
  let capturedPathname: string | null = null;
  let capturedPayload: unknown = null;

  const worker = createBiometricVerifierWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        capturedPathname = new URL(request.url).pathname;
        capturedPayload = await request.json();

        return new Response(
          JSON.stringify({
            livenessPassed: true,
            livenessScore: 0.92,
            faceMatchPassed: true,
            faceMatchScore: 0.91,
            faceMatchAlignment: "mesh",
            padPassed: true,
            padScore: 0.85,
            usedFallback: false,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }
        );
      },
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: createBiometricVerifierRequestFormData({
        ...buildValidPayloadParams(portrait, videoBytes),
        faceMatchThreshold: 0.7853,
      }),
      headers: {
        [BIOMETRIC_VERIFIER_AUTH_HEADER]: "test-secret",
      },
      method: "POST",
    }),
    createBindings({
      BIOMETRIC_VERIFIER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(200);
  if (capturedPathname !== "/verify") {
    throw new Error(
      `Expected container path to be /verify, got ${capturedPathname}`
    );
  }
  expect(capturedPayload).toEqual(
    expect.objectContaining({
      dg2Image: expect.objectContaining({
        bytesBase64: expect.any(String),
        format: expect.any(String),
      }),
      videoBase64: expect.any(String),
      faceMatchThreshold: 0.7853,
    })
  );
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload).toEqual({
    livenessPassed: true,
    livenessScore: 0.92,
    faceMatchPassed: true,
    faceMatchScore: 0.91,
    faceMatchAlignment: "mesh",
    padPassed: true,
    padScore: 0.85,
    usedFallback: false,
  });
});

test("biometric verifier worker rejects malformed requests", async () => {
  const worker = createBiometricVerifierWorker({ emitRequestLogs: false });
  const formData = new FormData();
  formData.append("faceMatchThreshold", "bad");

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: formData,
      headers: {
        [BIOMETRIC_VERIFIER_AUTH_HEADER]: "test-secret",
      },
      method: "POST",
    }),
    createBindings({
      BIOMETRIC_VERIFIER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(400);
});

test("biometric verifier worker rejects oversized multipart bodies before parsing", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const videoBytes = new Uint8Array(8192).fill(2);
  let containerCalled = false;

  const formData = createBiometricVerifierRequestFormData({
    ...buildValidPayloadParams(portrait, videoBytes),
  });

  const worker = createBiometricVerifierWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: () => {
        containerCalled = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: formData,
      headers: {
        [BIOMETRIC_VERIFIER_AUTH_HEADER]: "test-secret",
        "content-length": String(BIOMETRIC_VERIFIER_MAX_REQUEST_BYTES + 1),
      },
      method: "POST",
    }),
    createBindings({
      BIOMETRIC_VERIFIER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(413);
  expect(containerCalled).toBe(false);
});

test("biometric verifier worker fails closed (503) when the shared secret is missing", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const videoBytes = new Uint8Array(8192).fill(3);
  const worker = createBiometricVerifierWorker({ emitRequestLogs: false });

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: createBiometricVerifierRequestFormData(
        buildValidPayloadParams(portrait, videoBytes)
      ),
      headers: {
        [BIOMETRIC_VERIFIER_AUTH_HEADER]: "anything",
      },
      method: "POST",
    }),
    createBindings(),
    createExecutionContext()
  );

  expect(response.status).toBe(503);
  const payload = (await response.json()) as { error?: { code?: string } };
  expect(payload.error?.code).toBe("BIOMETRIC_VERIFIER_MISCONFIGURED");
});

test("biometric verifier worker accepts the bearer auth header", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const videoBytes = new Uint8Array(8192).fill(4);
  const worker = createBiometricVerifierWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async () =>
        new Response(
          JSON.stringify({
            livenessPassed: true,
            livenessScore: 0.9,
            faceMatchPassed: true,
            faceMatchScore: 0.9,
            padPassed: true,
            padScore: 0.85,
            usedFallback: false,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }
        ),
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: createBiometricVerifierRequestFormData(
        buildValidPayloadParams(portrait, videoBytes)
      ),
      headers: {
        authorization: "Bearer test-secret",
      },
      method: "POST",
    }),
    createBindings({
      BIOMETRIC_VERIFIER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(200);
});

test("biometric verifier worker rejects unauthorized requests", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const videoBytes = new Uint8Array(8192).fill(5);
  const worker = createBiometricVerifierWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async () =>
        new Response(
          JSON.stringify({
            livenessPassed: true,
            livenessScore: 0.9,
            faceMatchPassed: true,
            faceMatchScore: 0.9,
            padPassed: true,
            padScore: 0.85,
            usedFallback: false,
          }),
          {
            headers: {
              "content-type": "application/json",
            },
            status: 200,
          }
        ),
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://biometric-verifier/verify", {
      body: createBiometricVerifierRequestFormData(
        buildValidPayloadParams(portrait, videoBytes)
      ),
      headers: {
        [BIOMETRIC_VERIFIER_AUTH_HEADER]: "wrong-secret",
      },
      method: "POST",
    }),
    createBindings({
      BIOMETRIC_VERIFIER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(401);
});

test("ignored marker reference", () => {
  expect(BIOMETRIC_VERIFIER_DG2_FIELD).toBe("dg2");
  expect(BIOMETRIC_VERIFIER_VIDEO_FIELD).toBe("video");
});
