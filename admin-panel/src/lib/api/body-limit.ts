/**
 * Shared request-body byte cap.
 *
 * A declared `Content-Length` header is not a reliable signal on its own — a
 * chunked request (no `Content-Length` at all) sails straight past a check
 * that only looks at that header. This module counts actual bytes as they
 * are read off the stream and aborts the moment the cap is crossed, however
 * the body was framed.
 *
 * `parseJsonBody` in `./middleware` (the /api/v1 surface) builds on the same
 * primitive; this module exists so every other route under `src/app/api`
 * can share it too instead of duplicating the read loop.
 */

import { ApiPayloadTooLargeError } from './errors';

/** Matches the declared-Content-Length cap in `proxy.ts` (1MB). */
export const DEFAULT_MAX_BODY_BYTES = 1_048_576;

/**
 * Read a request body as UTF-8 text, aborting with `ApiPayloadTooLargeError`
 * the moment more than `maxBytes` have been read — regardless of whether the
 * request declared a `Content-Length`.
 */
export async function readBodyWithByteLimit(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new ApiPayloadTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf-8');
}

/**
 * Drop-in, byte-capped replacement for `request.json()`. Parsing failures
 * throw the same way `request.json()` does (a `SyntaxError` from
 * `JSON.parse`), so existing call sites keep their current handling for
 * malformed JSON — only an oversized body behaves differently, throwing
 * `ApiPayloadTooLargeError` instead of being read in full.
 */
export async function readJsonBody<T = unknown>(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<T> {
  const text = await readBodyWithByteLimit(request, maxBytes);
  return JSON.parse(text) as T;
}

export { ApiPayloadTooLargeError };
