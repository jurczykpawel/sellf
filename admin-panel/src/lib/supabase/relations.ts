/**
 * Supabase relationship normalization helpers.
 *
 * Supabase's PostgREST embeds and the generated types infer a to-one (single FK)
 * relationship as an array, but a single FK match yields one object at runtime.
 * `firstRelated` normalizes both shapes to a single value (or null), so callers
 * don't repeat the `Array.isArray(rel) ? rel[0] : rel` dance at every embed site.
 *
 * Used by the bundle-component embeds (the FK-hinted `component:products!...` joins
 * are to-one but typed as arrays).
 */

/**
 * Normalize a Supabase to-one related record to a single value (or null).
 * Accepts either the array shape (typed) or the object shape (runtime); an empty
 * array, null, or undefined all collapse to null.
 */
export function firstRelated<T>(rel: unknown): T | null {
  if (Array.isArray(rel)) {
    return (rel.length > 0 ? rel[0] : null) as T | null;
  }
  return (rel ?? null) as T | null;
}
