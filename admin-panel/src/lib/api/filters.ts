export const FILTER_MAX_VALUES = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export interface ParsedFilter {
  ids: string[];
  slugs: string[];
}

export function parseCsvFilter(raw: string | null | undefined): ParsedFilter {
  if (!raw) return { ids: [], slugs: [] };
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length > FILTER_MAX_VALUES) {
    throw new Error(`too many values (max ${FILTER_MAX_VALUES})`);
  }
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const part of parts) {
    if (UUID_RE.test(part)) {
      ids.add(part.toLowerCase());
    } else if (SLUG_RE.test(part)) {
      slugs.add(part);
    } else {
      throw new Error(`invalid filter value: ${part.slice(0, 20)}`);
    }
  }
  return { ids: [...ids], slugs: [...slugs] };
}
