import { z } from "zod";
import { workspaceHeaders } from "../../shared/families";

const errorSchema = z.object({ error: z.string().optional() });

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  body?: unknown,
  account?: string,
  method?: string,
): Promise<T> {
  const response = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: {
      "X-Places-Photos": "1",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(account ? workspaceHeaders(account) : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      errorSchema.safeParse(data).data?.error ?? "serviceUnavailable",
    );
  }

  return (await response.json()) as T;
}
