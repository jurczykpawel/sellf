// Promise.allSettled wrapper that returns counts. Used by DLQ batch actions
// (Replay/Cancel selected) so partial failures show up in a single toast.
export async function runBatch<T>(
  items: T[],
  fn: (item: T) => Promise<unknown>,
): Promise<{ succeeded: number; failed: number }> {
  if (items.length === 0) return { succeeded: 0, failed: 0 };
  const results = await Promise.allSettled(items.map((item) => fn(item)));
  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') succeeded++;
    else failed++;
  }
  return { succeeded, failed };
}
