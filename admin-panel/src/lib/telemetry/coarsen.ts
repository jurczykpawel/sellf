/**
 * Coarsen high-entropy host facts into low-cardinality buckets so the raw values
 * (exact RAM, exact CPU count, exact runtime version) never leave the instance.
 *
 * Pure functions — no I/O, no env reads. The collector (collect.ts) feeds them
 * `node:os` readings; the receiver only ever sees the bucket label.
 *
 * @see ./collect.ts — caller (collectDeployment)
 */

/** Total memory (MiB) → coarse GiB band. */
export function memBucket(mb: number): string {
  const gb = mb / 1024;
  if (gb < 1) return '<1G';
  if (gb < 2) return '1-2';
  if (gb < 4) return '2-4';
  if (gb < 8) return '4-8';
  if (gb < 16) return '8-16';
  if (gb < 32) return '16-32';
  return '32+';
}

/** Logical CPU count → coarse band. */
export function cpuBucket(n: number): string {
  if (n <= 1) return '1';
  if (n === 2) return '2';
  if (n <= 4) return '3-4';
  if (n <= 8) return '5-8';
  return '9+';
}

/** Strip minor/patch (and a leading `v`) from a version string → major only. */
export function majorVersion(v: string): string {
  const m = v.replace(/^v/, '').match(/^(\d+)/);
  return m ? m[1] : 'unknown';
}
