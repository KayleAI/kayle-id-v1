const textDecoder = new TextDecoder();

export class RequestBodyTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

function getContentLength(request: Request): number | null {
  const value = request.headers.get("content-length");
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("request_content_length_invalid");
  }

  return parsed;
}

export async function readRequestBytesWithLimit(
  request: Request,
  limitBytes: number
): Promise<Uint8Array> {
  const contentLength = getContentLength(request);
  if (contentLength !== null && contentLength > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }

  if (!request.body) {
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      totalBytes += value.byteLength;
      if (totalBytes > limitBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(limitBytes);
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bodyBytes;
}

export async function readRequestTextWithLimit(
  request: Request,
  limitBytes: number
): Promise<string> {
  return textDecoder.decode(
    await readRequestBytesWithLimit(request, limitBytes)
  );
}

export async function readRequestJsonWithLimit<T>(
  request: Request,
  limitBytes: number
): Promise<T> {
  return JSON.parse(await readRequestTextWithLimit(request, limitBytes)) as T;
}

export function isRequestBodyTooLarge(
  error: unknown
): error is RequestBodyTooLargeError {
  return error instanceof RequestBodyTooLargeError;
}
