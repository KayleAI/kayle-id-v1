import { expect, test } from "bun:test";
import {
  createFaceMatcherRequestFormData,
  FACE_MATCHER_AUTH_HEADER,
  FACE_MATCHER_DG2_FIELD,
  FACE_MATCHER_MAX_REQUEST_BYTES,
  FACE_MATCHER_MAX_SELFIES,
  FACE_MATCHER_SELFIE_FIELD_PREFIX,
} from "@kayle-id/config/face-matcher";
import {
  createDg2Artifact,
  loadVerifyFixtureBytes,
} from "../../../apps/api/tests/helpers/verify-artifacts";
import { createFaceMatcherWorker } from "./worker";

type TestFaceMatcherBindings = Partial<FaceMatcherBindings> & {
  FACE_MATCHER_SECRET?: string;
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
  bindings: TestFaceMatcherBindings = {}
): FaceMatcherBindings {
  return bindings as FaceMatcherBindings;
}

test("face matcher worker returns a passing score for valid inputs", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const dg2 = createDg2Artifact({
    imageData: portrait,
    imageFormat: "jpeg",
    wrapWithEfTag: true,
  });
  let capturedPathname: string | null = null;
  let capturedPayload: unknown = null;

  const worker = createFaceMatcherWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async (input, init) => {
        const request = new Request(input, init);
        capturedPathname = new URL(request.url).pathname;
        capturedPayload = await request.json();

        return new Response(
          JSON.stringify({
            faceScore: 0.91,
            passed: true,
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
    createWorkerRequest("http://face-matcher/match", {
      body: createFaceMatcherRequestFormData({
        dg2Image: dg2,
        selfies: [portrait],
        threshold: 0.7853,
      }),
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "test-secret",
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(200);
  const matcherPathname = capturedPathname;

  if (matcherPathname === null) {
    throw new Error("Expected matcher container pathname to be captured");
  }
  if (matcherPathname !== "/match") {
    throw new Error(
      `Expected matcher path to be /match, got ${matcherPathname}`
    );
  }
  expect(capturedPayload).toEqual(
    expect.objectContaining({
      dg2Image: expect.objectContaining({
        bytesBase64: expect.any(String),
        format: expect.any(String),
      }),
      selfiesBase64: [expect.any(String)],
      threshold: 0.7853,
    })
  );
  const payload = (await response.json()) as Record<string, unknown>;
  expect(payload).toEqual({
    faceScore: 0.91,
    passed: true,
    usedFallback: false,
  });
});

test("face matcher worker rejects malformed requests", async () => {
  const worker = createFaceMatcherWorker({ emitRequestLogs: false });
  const formData = new FormData();
  formData.append("threshold", "bad");

  const response = await worker.fetch(
    createWorkerRequest("http://face-matcher/match", {
      body: formData,
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "test-secret",
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(400);
});

test("face matcher worker rejects excessive selfie payloads before the container", async () => {
  const formData = new FormData();
  let containerCalled = false;

  formData.append(FACE_MATCHER_DG2_FIELD, new Blob([new Uint8Array([1])]));
  for (let index = 0; index <= FACE_MATCHER_MAX_SELFIES; index += 1) {
    formData.append(
      `${FACE_MATCHER_SELFIE_FIELD_PREFIX}${index}`,
      new Blob([new Uint8Array([index + 1])])
    );
  }

  const worker = createFaceMatcherWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: () => {
        containerCalled = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://face-matcher/match", {
      body: formData,
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "test-secret",
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(400);
  expect(containerCalled).toBe(false);
});

test("face matcher worker rejects oversized multipart bodies before parsing", async () => {
  const formData = new FormData();
  let containerCalled = false;

  formData.append(FACE_MATCHER_DG2_FIELD, new Blob([new Uint8Array([1])]));
  formData.append(
    `${FACE_MATCHER_SELFIE_FIELD_PREFIX}0`,
    new Blob([new Uint8Array([2])])
  );

  const worker = createFaceMatcherWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: () => {
        containerCalled = true;
        return Promise.resolve(new Response(null, { status: 500 }));
      },
    }),
  });

  const response = await worker.fetch(
    createWorkerRequest("http://face-matcher/match", {
      body: formData,
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "test-secret",
        "content-length": String(FACE_MATCHER_MAX_REQUEST_BYTES + 1),
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(413);
  expect(containerCalled).toBe(false);
});

test("face matcher worker fails closed (503) when the shared secret is missing", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const worker = createFaceMatcherWorker({ emitRequestLogs: false });

  const response = await worker.fetch(
    createWorkerRequest("http://face-matcher/match", {
      body: createFaceMatcherRequestFormData({
        dg2Image: createDg2Artifact({
          imageData: portrait,
          imageFormat: "jpeg",
        }),
        selfies: [portrait],
      }),
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "anything",
      },
      method: "POST",
    }),
    createBindings(),
    createExecutionContext()
  );

  expect(response.status).toBe(503);
  const payload = (await response.json()) as { error?: { code?: string } };
  expect(payload.error?.code).toBe("MATCHER_MISCONFIGURED");
});

test("face matcher worker accepts the bearer auth header", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const worker = createFaceMatcherWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async () =>
        new Response(
          JSON.stringify({
            faceScore: 0.91,
            passed: true,
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
    createWorkerRequest("http://face-matcher/match", {
      body: createFaceMatcherRequestFormData({
        dg2Image: createDg2Artifact({
          imageData: portrait,
          imageFormat: "jpeg",
        }),
        selfies: [portrait],
      }),
      headers: {
        authorization: "Bearer test-secret",
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(200);
});

test("face matcher worker rejects unauthorized requests", async () => {
  const portrait = await loadVerifyFixtureBytes("icon.jpg");
  const worker = createFaceMatcherWorker({
    emitRequestLogs: false,
    getContainer: async () => ({
      fetch: async () =>
        new Response(
          JSON.stringify({
            faceScore: 0.91,
            passed: true,
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
    createWorkerRequest("http://face-matcher/match", {
      body: createFaceMatcherRequestFormData({
        dg2Image: createDg2Artifact({
          imageData: portrait,
          imageFormat: "jpeg",
        }),
        selfies: [portrait],
      }),
      headers: {
        [FACE_MATCHER_AUTH_HEADER]: "wrong-secret",
      },
      method: "POST",
    }),
    createBindings({
      FACE_MATCHER_SECRET: "test-secret",
    }),
    createExecutionContext()
  );

  expect(response.status).toBe(401);
});
