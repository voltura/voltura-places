/** Transport errors stay independent of account/session and entity validation. */
export class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export function privateJSON(body: unknown, status = 200, headers: HeadersInit = {}) {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  result.set("Vary", "Cookie");
  result.set("X-Content-Type-Options", "nosniff");

  return Response.json(body, { status, headers: result });
}

export function hasCanonicalOrigin(request: Request, origin: string) {
  return (
    request.headers.get("Origin") === origin &&
    new URL(request.url).origin === origin &&
    request.headers.get("Sec-Fetch-Site") !== "cross-site"
  );
}

/** Bound memory by bytes, even for chunked bodies or dishonest Content-Length. */
export async function readBytes(
  request: Pick<Request, "headers" | "body">,
  limit: number,
  missingStatus = 400,
) {
  const declared = request.headers?.get("Content-Length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    if (request.body && !request.body.locked) {
      void request.body.cancel().catch(() => {});
    }
    throw new RequestError(413, "The request is too large. Nothing was changed.");
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new RequestError(missingStatus, "Request required.");
  }
  let bytes = new Uint8Array(0);
  let size = 0;
  let complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;

        return bytes.subarray(0, size);
      }
      if (value.byteLength > limit - size) {
        throw new RequestError(413, "The request is too large. Nothing was changed.");
      }
      if (size + value.byteLength > bytes.byteLength) {
        const capacity = Math.min(
          limit,
          Math.max(8192, bytes.byteLength * 2, size + value.byteLength),
        );
        const grown = new Uint8Array(capacity);
        grown.set(bytes.subarray(0, size));
        bytes = grown;
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, "Invalid request.");
  } finally {
    // Cancellation failure must not replace the original size/encoding error.
    if (!complete) {
      void reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}

export async function readJSON(request: Request, limit: number): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new RequestError(415, "JSON required.");
  }
  const bytes = await readBytes(request, limit);
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new RequestError(400, "Invalid request.");
    }

    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }
    throw new RequestError(400, "Invalid request.");
  }
}
