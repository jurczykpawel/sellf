# Products filtering + Tags CRUD API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać 3 rzeczy do API v1 Sellf admin-panel:
1. **Filtrowanie produktów po kategorii** w `GET /api/v1/products` (UUID lub slug, intersection dla wielu).
2. **Pełen CRUD tagów** (`/api/v1/tags`, `/api/v1/tags/[id]`) + tag assignment podczas create/update produktu.
3. **Filtrowanie produktów po tagu** w `GET /api/v1/products` (analogicznie do kategorii).

**Architecture:** Zero nowych migracji DB — tabele `seller_main.tags`, `seller_main.product_tags`, public views z `security_invoker=on` już istnieją (core_schema 20250101000000). RLS pozwala admin/service_role na full CRUD; API używa `createAdminClient()` przez istniejący `authenticate()` helper. Embed mechanism (opt-in `?embed=categories,tags`) wprowadzamy jako wspólny helper żeby uniknąć duplikacji między products list a single endpoint.

**Tech Stack:** Next.js 16 App Router, Zod v4, Vitest (unit + API integration), Supabase admin client, istniejący wzorzec `src/app/api/v1/<resource>/route.ts`.

**Decyzje projektowe (potwierdzone przez usera):**
- Filter param: `?category=<uuid-or-slug>` + `?tag=<uuid-or-slug>` (auto-detect po UUID regex).
- Multiple: comma-separated, **AND intersection** (`?category=a,b` = produkt musi mieć obie).
- Embed: **opt-in** `?embed=categories,tags` (nie psuje obecnych klientów). Domyślnie nie ma w response.
- **Zero migracji** — schema już wszystko ma.

**Out of scope (potwierdzone z userem):**
- Categories CRUD API (kategorie zarządzane wyłącznie przez admin UI, API tylko czyta jako filter).
- Admin UI dla tagów.
- Tag-based filtering w storefront UI.
- Tag analytics / popular tags.
- Cokolwiek w innych repo (techskills.academy).

---

## File structure

**Tworzymy:**
- `admin-panel/src/lib/api/embed.ts` — DRY helper: `parseEmbed`, `buildProductSelect`, `transformEmbeddedRelations`.
- `admin-panel/src/lib/api/filters.ts` — DRY helper: `parseCsvFilter` (auto-detect uuid vs slug), `resolveCategoryIds`, `resolveTagIds`.
- `admin-panel/src/lib/api/dto/tag.ts` — Zod DTOs `TagCreateDTO`, `TagUpdateDTO`.
- `admin-panel/src/app/api/v1/tags/route.ts` — list + create.
- `admin-panel/src/app/api/v1/tags/[id]/route.ts` — get + patch + delete.
- `admin-panel/tests/unit/api/embed.test.ts` — pure unit tests dla embed helpera.
- `admin-panel/tests/unit/api/filters.test.ts` — pure unit tests dla filter parsera.
- `admin-panel/tests/api/tags.test.ts` — integration tests dla tags CRUD.

**Modyfikujemy:**
- `admin-panel/src/app/api/v1/products/route.ts` — embed + category/tag filtering w GET, accept `tags: string[]` w POST.
- `admin-panel/src/app/api/v1/products/[id]/route.ts` — refactor na shared embed helper, accept `tags: string[]` w PATCH (replace semantics).
- `admin-panel/src/lib/api/dto/product.ts` — `tags: z.array(z.string().uuid()).max(50).optional()` w `baseShape`.
- `admin-panel/src/lib/api/index.ts` — re-export embed/filters helpers.
- `admin-panel/tests/api/products.test.ts` — dorzucamy testy: embed, filter by category, filter by tag, tag assignment.
- `admin-panel/tests/api/setup.ts` — `cleanup()` z `tags?: string[]`.

**Bruno collection (opcjonalnie):** `bruno/v1-tags.bru`, `v1-products-filtered.bru` — pomijamy jeśli user nie używa Bruno aktywnie.

---

## Pre-flight

### Task 0: Worktree + lokalne środowisko

- [ ] **Step 1: Utwórz worktree**

```bash
cd /Users/pavvel/workspace/projects/sellf
git fetch origin
git worktree add -b feat/products-filtering-tags-crud .claude/worktrees/feat-products-filtering-tags-crud origin/main
cd .claude/worktrees/feat-products-filtering-tags-crud/admin-panel
bun install
```

- [ ] **Step 2: Lokalne Supabase + dev server (osobne terminale przez Monitor lub run_in_background)**

```bash
# z worktree root, NIE z admin-panel
cd /Users/pavvel/workspace/projects/sellf/.claude/worktrees/feat-products-filtering-tags-crud
npx supabase start
npx supabase db reset

# w admin-panel/
cd admin-panel
bun run dev   # http://localhost:3000 (lub 3777 jeśli env)
```

- [ ] **Step 3: Sanity check — tags table dostępny przez service role**

```bash
docker exec -i $(docker ps --filter name=supabase_db_ --format '{{.Names}}' | head -1) \
  psql -U postgres -c "SELECT count(*) FROM seller_main.tags;"
```
Expected: `0` (lub liczba seed tagów). Brak błędu = schema OK, **żadnej migracji nie tworzymy**.

---

## Part A — DRY helpers (TDD, pure unit tests)

### Task 1: Embed helper — `parseEmbed`, `buildProductSelect`, `transformEmbeddedRelations`

**Files:**
- Create: `admin-panel/src/lib/api/embed.ts`
- Create: `admin-panel/tests/unit/api/embed.test.ts`

Rationale: zarówno GET list jak GET single, oba mają zwracać categories/tags w spójnym shape. Bez helpera kod się duplikuje i rozjeżdża. SRP per funkcja.

- [ ] **Step 1: Napisz failing testy**

```ts
// admin-panel/tests/unit/api/embed.test.ts
import { describe, it, expect } from 'vitest';
import { parseEmbed, buildProductSelect, transformEmbeddedRelations } from '@/lib/api/embed';

describe('parseEmbed', () => {
  it('returns empty set for null', () => {
    expect(parseEmbed(null).size).toBe(0);
  });
  it('parses single key', () => {
    expect(parseEmbed('categories')).toEqual(new Set(['categories']));
  });
  it('parses comma-separated', () => {
    expect(parseEmbed('categories,tags')).toEqual(new Set(['categories', 'tags']));
  });
  it('trims whitespace', () => {
    expect(parseEmbed(' categories , tags ')).toEqual(new Set(['categories', 'tags']));
  });
  it('ignores unknown keys', () => {
    expect(parseEmbed('categories,evil')).toEqual(new Set(['categories']));
  });
  it('deduplicates', () => {
    expect(parseEmbed('tags,tags')).toEqual(new Set(['tags']));
  });
});

describe('buildProductSelect', () => {
  const BASE = 'id, name, slug';
  it('returns base when no embed', () => {
    expect(buildProductSelect(BASE, new Set())).toBe(BASE);
  });
  it('appends product_categories relation when categories embed', () => {
    const out = buildProductSelect(BASE, new Set(['categories']));
    expect(out).toContain(BASE);
    expect(out).toContain('product_categories');
    expect(out).toContain('categories ( id, name, slug )');
  });
  it('appends product_tags relation when tags embed', () => {
    const out = buildProductSelect(BASE, new Set(['tags']));
    expect(out).toContain('product_tags');
    expect(out).toContain('tags ( id, name, slug )');
  });
  it('appends both', () => {
    const out = buildProductSelect(BASE, new Set(['categories', 'tags']));
    expect(out).toContain('product_categories');
    expect(out).toContain('product_tags');
  });
});

describe('transformEmbeddedRelations', () => {
  it('flattens product_categories.categories → categories', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_categories: [
        { category_id: 'c1', categories: { id: 'c1', name: 'A', slug: 'a' } },
        { category_id: 'c2', categories: { id: 'c2', name: 'B', slug: 'b' } },
      ],
    });
    expect(out.categories).toEqual([
      { id: 'c1', name: 'A', slug: 'a' },
      { id: 'c2', name: 'B', slug: 'b' },
    ]);
    expect(out).not.toHaveProperty('product_categories');
  });
  it('flattens product_tags.tags → tags', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_tags: [{ tag_id: 't1', tags: { id: 't1', name: 'X', slug: 'x' } }],
    });
    expect(out.tags).toEqual([{ id: 't1', name: 'X', slug: 'x' }]);
    expect(out).not.toHaveProperty('product_tags');
  });
  it('drops null relations from join (defensive)', () => {
    const out = transformEmbeddedRelations({
      id: 'p1',
      product_tags: [{ tag_id: 't1', tags: null }],
    });
    expect(out.tags).toEqual([]);
  });
  it('passthrough for rows without embedded relations', () => {
    expect(transformEmbeddedRelations({ id: 'p1', name: 'P' })).toEqual({ id: 'p1', name: 'P' });
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bunx vitest run tests/unit/api/embed.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implementacja**

```ts
// admin-panel/src/lib/api/embed.ts
export type EmbedKey = 'categories' | 'tags';
const ALLOWED: ReadonlySet<EmbedKey> = new Set(['categories', 'tags']);

export function parseEmbed(raw: string | null | undefined): Set<EmbedKey> {
  if (!raw) return new Set();
  const out = new Set<EmbedKey>();
  for (const part of raw.split(',')) {
    const key = part.trim() as EmbedKey;
    if (ALLOWED.has(key)) out.add(key);
  }
  return out;
}

export function buildProductSelect(baseFields: string, embed: ReadonlySet<EmbedKey>): string {
  const parts: string[] = [baseFields];
  if (embed.has('categories')) {
    parts.push('product_categories ( category_id, categories ( id, name, slug ) )');
  }
  if (embed.has('tags')) {
    parts.push('product_tags ( tag_id, tags ( id, name, slug ) )');
  }
  return parts.join(', ');
}

type EmbeddedRow = Record<string, unknown> & {
  product_categories?: Array<{ category_id: unknown; categories: unknown }> | null;
  product_tags?: Array<{ tag_id: unknown; tags: unknown }> | null;
};

export function transformEmbeddedRelations<T extends EmbeddedRow>(row: T): Omit<T, 'product_categories' | 'product_tags'> & { categories?: unknown[]; tags?: unknown[] } {
  const { product_categories, product_tags, ...rest } = row;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(product_categories)) {
    out.categories = product_categories.map((pc) => pc.categories).filter((x) => x != null);
  }
  if (Array.isArray(product_tags)) {
    out.tags = product_tags.map((pt) => pt.tags).filter((x) => x != null);
  }
  return out as Omit<T, 'product_categories' | 'product_tags'> & { categories?: unknown[]; tags?: unknown[] };
}
```

- [ ] **Step 4: Test pass**

```bash
bunx vitest run tests/unit/api/embed.test.ts
```
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/api/embed.ts admin-panel/tests/unit/api/embed.test.ts
git commit -m "feat(api): add embed helper for relation projection"
```

---

### Task 2: Filter helper — `parseCsvFilter` (auto-detect UUID vs slug)

**Files:**
- Create: `admin-panel/src/lib/api/filters.ts`
- Create: `admin-panel/tests/unit/api/filters.test.ts`

Rationale: ten sam parser dla `?category=` i `?tag=`. Wynik: `{ ids: string[]; slugs: string[] }`. Resolver `resolveCategoryIds` (async) zamienia slugi na ID przez query do bazy — używamy go w endpoint, ale parser jest pure.

- [ ] **Step 1: Napisz failing testy**

```ts
// admin-panel/tests/unit/api/filters.test.ts
import { describe, it, expect } from 'vitest';
import { parseCsvFilter, FILTER_MAX_VALUES } from '@/lib/api/filters';

describe('parseCsvFilter', () => {
  it('returns empty for null', () => {
    expect(parseCsvFilter(null)).toEqual({ ids: [], slugs: [] });
  });
  it('classifies UUID into ids', () => {
    expect(parseCsvFilter('d192cab8-fb9c-407b-88e1-69245bb607c3')).toEqual({
      ids: ['d192cab8-fb9c-407b-88e1-69245bb607c3'],
      slugs: [],
    });
  });
  it('classifies slug into slugs', () => {
    expect(parseCsvFilter('starter-pack')).toEqual({ ids: [], slugs: ['starter-pack'] });
  });
  it('mixes UUID and slug from same csv', () => {
    const out = parseCsvFilter('d192cab8-fb9c-407b-88e1-69245bb607c3,courses');
    expect(out.ids).toEqual(['d192cab8-fb9c-407b-88e1-69245bb607c3']);
    expect(out.slugs).toEqual(['courses']);
  });
  it('lowercases UUIDs (canonical form)', () => {
    const out = parseCsvFilter('D192CAB8-FB9C-407B-88E1-69245BB607C3');
    expect(out.ids).toEqual(['d192cab8-fb9c-407b-88e1-69245bb607c3']);
  });
  it('trims whitespace', () => {
    expect(parseCsvFilter(' a , b ')).toEqual({ ids: [], slugs: ['a', 'b'] });
  });
  it('drops empty entries from trailing commas', () => {
    expect(parseCsvFilter('a,,b,')).toEqual({ ids: [], slugs: ['a', 'b'] });
  });
  it('deduplicates within each bucket', () => {
    const out = parseCsvFilter('a,a,b');
    expect(out.slugs).toEqual(['a', 'b']);
  });
  it('throws when slug fails slug regex', () => {
    expect(() => parseCsvFilter('has space')).toThrow(/invalid/i);
  });
  it('throws when total values exceed FILTER_MAX_VALUES', () => {
    const many = Array.from({ length: FILTER_MAX_VALUES + 1 }, (_, i) => `s${i}`).join(',');
    expect(() => parseCsvFilter(many)).toThrow(/too many/i);
  });
});
```

- [ ] **Step 2: Run failing**

- [ ] **Step 3: Implementacja**

```ts
// admin-panel/src/lib/api/filters.ts
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
```

- [ ] **Step 4: Test pass + commit**

```bash
bunx vitest run tests/unit/api/filters.test.ts
git add admin-panel/src/lib/api/filters.ts admin-panel/tests/unit/api/filters.test.ts
git commit -m "feat(api): add csv filter parser with uuid/slug auto-detect"
```

---

## Part B — Wire helpers into products GET endpoint (refactor + new behavior)

### Task 3: Embed `?embed=categories,tags` w GET /products + GET /products/[id]

**Files:**
- Modify: `admin-panel/src/app/api/v1/products/route.ts`
- Modify: `admin-panel/src/app/api/v1/products/[id]/route.ts`
- Modify: `admin-panel/tests/api/products.test.ts`

Single endpoint dziś już zwraca `categories` z ad-hoc transformem. Refactor na shared helper eliminuje duplikację + dodaje tags.

- [ ] **Step 1: Failing integration tests dla embed**

```ts
// W admin-panel/tests/api/products.test.ts (po istniejących describe blokach):

describe('GET /api/v1/products embed param', () => {
  it('returns NO categories/tags by default', async () => {
    const { status, data } = await get<ApiResponse<Array<Product & Record<string, unknown>>>>('/api/v1/products?limit=1');
    expect(status).toBe(200);
    if (data.data!.length) {
      expect(data.data![0]).not.toHaveProperty('categories');
      expect(data.data![0]).not.toHaveProperty('tags');
    }
  });
  it('includes categories when ?embed=categories', async () => {
    const { status, data } = await get<ApiResponse<Array<Product & { categories?: unknown[] }>>>('/api/v1/products?limit=1&embed=categories');
    expect(status).toBe(200);
    if (data.data!.length) {
      expect(data.data![0]).toHaveProperty('categories');
      expect(Array.isArray(data.data![0].categories)).toBe(true);
    }
  });
  it('includes both when ?embed=categories,tags', async () => {
    const { data } = await get<ApiResponse<Array<Product & { categories?: unknown; tags?: unknown }>>>('/api/v1/products?limit=1&embed=categories,tags');
    if (data.data!.length) {
      expect(data.data![0]).toHaveProperty('categories');
      expect(data.data![0]).toHaveProperty('tags');
    }
  });
  it('ignores unknown embed keys gracefully', async () => {
    const { status } = await get<ApiResponse<Array<Product>>>('/api/v1/products?limit=1&embed=evil');
    expect(status).toBe(200);
  });
});

describe('GET /api/v1/products/[id] embed shape', () => {
  let createdId: string;
  beforeAll(async () => {
    const slug = uniqueSlug();
    const r = await post<ApiResponse<Product & { id: string }>>('/api/v1/products', {
      name: 'Embed shape test', slug, description: 'd', price: 1,
    });
    createdId = r.data.data!.id;
    createdProductIds.push(createdId);
  });
  it('returns categories+tags arrays by default (single endpoint always embeds both)', async () => {
    const { status, data } = await get<ApiResponse<Product & { categories: unknown[]; tags: unknown[] }>>(`/api/v1/products/${createdId}`);
    expect(status).toBe(200);
    expect(Array.isArray(data.data!.categories)).toBe(true);
    expect(Array.isArray(data.data!.tags)).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing**

```bash
bun run test:api -- products.test.ts -t embed
```
Expected: FAIL (no embed support, no tags property).

- [ ] **Step 3: Refactor GET list w `admin-panel/src/app/api/v1/products/route.ts`**

W górze pliku — dorzucić import:
```ts
import { parseEmbed, buildProductSelect, transformEmbeddedRelations } from '@/lib/api/embed';
```

Wewnątrz `GET` po sparsowaniu query params:
```ts
const embed = parseEmbed(searchParams.get('embed'));
```

Zamienić:
```ts
let query = supabase.from('products').select(PRODUCT_API_FIELDS);
```
na:
```ts
let query = supabase.from('products').select(buildProductSelect(PRODUCT_API_FIELDS, embed));
```

Przed `return jsonResponse(successResponse(items, ...))` dodać transform:
```ts
const transformed = embed.size > 0
  ? (items as unknown[]).map((row) => transformEmbeddedRelations(row as Record<string, unknown>))
  : items;
return jsonResponse(successResponse(transformed, { ...pagination, total: count ?? undefined }), request);
```

- [ ] **Step 4: Refactor GET single w `admin-panel/src/app/api/v1/products/[id]/route.ts`**

Single endpoint dziś hardkoduje categories select + manualny transform. Przepisać:

```ts
import { parseEmbed, buildProductSelect, transformEmbeddedRelations } from '@/lib/api/embed';

// W GET (po validateProductId i przed select):
const embedParam = request.nextUrl.searchParams.get('embed') ?? 'categories,tags';
const embed = parseEmbed(embedParam);
const selectFields = buildProductSelect(PRODUCT_API_FIELDS, embed);

const { data: product, error } = await supabase
  .from('products')
  .select(selectFields)
  .eq('id', id)
  .single();

if (error) {
  if (error.code === 'PGRST116') return apiError(request, 'NOT_FOUND', 'Product not found');
  console.error('Error fetching product:', error);
  return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch product');
}

const transformed = transformEmbeddedRelations(product as Record<string, unknown>);
return jsonResponse(successResponse(transformed), request);
```

Usunąć stary manualny `categories = product.product_categories?.map(...)` block — zastąpiony przez helper.

- [ ] **Step 5: Test pass**

```bash
bun run test:api -- products.test.ts
```
Wszystkie istniejące + nowe tests = GREEN.

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/app/api/v1/products/route.ts \
        admin-panel/src/app/api/v1/products/'[id]'/route.ts \
        admin-panel/tests/api/products.test.ts
git commit -m "feat(api): opt-in categories/tags embed on products"
```

---

### Task 4: Filtrowanie produktów po kategorii (`?category=` w GET /products)

**Files:**
- Modify: `admin-panel/src/app/api/v1/products/route.ts`
- Modify: `admin-panel/tests/api/products.test.ts`

Semantyka: AND intersection. Dla `?category=a,b` produkt musi mieć **obie**. Implementacja: dla każdej kategorii w filtrze, generujemy podzapytanie `product_id IN (SELECT product_id FROM product_categories WHERE category_id = X)` i ANDujemy. Supabase JS: `.in('id', subquery)` per kategoria.

Pure parsing (uuid/slug split) już w `parseCsvFilter`. Resolver slug→id robimy w endpoint.

- [ ] **Step 1: Failing tests**

```ts
// W products.test.ts dodać:
describe('GET /api/v1/products ?category= filter', () => {
  let catA: string;
  let catB: string;
  let catASlug: string;
  let prodInA: string;
  let prodInB: string;
  let prodInBoth: string;

  beforeAll(async () => {
    // Tworzymy kategorie bezpośrednio w DB przez setup helper (categories CRUD jest out-of-scope dla tego planu).
    catASlug = `cat-a-${Date.now()}`;
    const { data: ca } = await supabaseAdmin().from('categories').insert({ name: 'A', slug: catASlug }).select('id').single();
    const { data: cb } = await supabaseAdmin().from('categories').insert({ name: 'B', slug: `cat-b-${Date.now()}` }).select('id').single();
    catA = ca!.id; catB = cb!.id;

    const make = async (cats: string[]) => {
      const { data } = await post<ApiResponse<{ id: string }>>('/api/v1/products', {
        name: 'F', slug: uniqueSlug(), description: 'd', price: 1, categories: cats,
      });
      const id = data.data!.id;
      createdProductIds.push(id);
      return id;
    };
    prodInA = await make([catA]);
    prodInB = await make([catB]);
    prodInBoth = await make([catA, catB]);
  });

  afterAll(async () => {
    await supabaseAdmin().from('categories').delete().in('id', [catA, catB]);
  });

  it('filters by category UUID', async () => {
    const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catA}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([prodInA, prodInBoth]));
    expect(ids).not.toContain(prodInB);
  });

  it('filters by category slug (auto-detect)', async () => {
    const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catASlug}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([prodInA, prodInBoth]));
    expect(ids).not.toContain(prodInB);
  });

  it('AND-intersects when ?category=a,b (returns only prodInBoth)', async () => {
    const { data } = await get<ApiResponse<Array<{ id: string }>>>(`/api/v1/products?category=${catA},${catB}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toContain(prodInBoth);
    expect(ids).not.toContain(prodInA);
    expect(ids).not.toContain(prodInB);
  });

  it('returns 400 on invalid filter value', async () => {
    const { status, data } = await get<ApiResponse<unknown>>('/api/v1/products?category=evil%20space');
    expect(status).toBe(400);
    expect(data.error?.code).toBe('INVALID_INPUT');
  });

  it('returns empty when category does not match any product', async () => {
    const { data } = await get<ApiResponse<unknown[]>>('/api/v1/products?category=00000000-0000-0000-0000-000000000000');
    expect(data.data).toEqual([]);
  });
});
```

`supabaseAdmin()` helper w `tests/api/setup.ts` — jeśli nie istnieje, dodaj jako `export const supabaseAdmin = () => supabase` (test client już używa service role key).

- [ ] **Step 2: Run failing**

Expected: filter param ignored, wrong counts.

- [ ] **Step 3: Implementacja filterowania po kategorii**

W `admin-panel/src/app/api/v1/products/route.ts` GET handler:

```ts
import { parseCsvFilter } from '@/lib/api/filters';

// Po parseEmbed:
let categoryFilter;
try {
  categoryFilter = parseCsvFilter(searchParams.get('category'));
} catch (e) {
  return apiError(request, 'INVALID_INPUT', e instanceof Error ? e.message : 'Invalid category filter');
}

const categoryIds = await resolveFilterIds(supabase, 'categories', categoryFilter);
if (categoryIds === null) {
  // żadne pasujące kategorie — zwracamy pustą listę bez query do products
  return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
}
```

W tym samym pliku (lub w `@/lib/api/filters.ts`) dodać async resolver. Decision: trzymamy w `filters.ts` żeby było blisko parsera:

```ts
// admin-panel/src/lib/api/filters.ts (DODAJ na końcu pliku)
import type { SupabaseClient } from '@supabase/supabase-js';

export type FilterTable = 'categories' | 'tags';

/**
 * Returns concrete UUID list to AND-intersect on, or null when slugs don't resolve.
 */
export async function resolveFilterIds(
  supabase: SupabaseClient,
  table: FilterTable,
  parsed: ParsedFilter,
): Promise<string[] | null> {
  const ids = [...parsed.ids];
  if (parsed.slugs.length) {
    const { data, error } = await supabase.from(table).select('id').in('slug', parsed.slugs);
    if (error) throw error;
    const found = (data ?? []).map((r) => r.id as string);
    if (found.length !== parsed.slugs.length) return null;
    ids.push(...found);
  }
  return ids;
}
```

Po resolverze, build query AND-intersect:

```ts
// Apply category intersection by chaining .in('id', subquery) per category
// Supabase doesn't support nested subselect in .filter(), so fall back to
// junction-table membership lookup once per category and intersect in app.
let restrictedIds: string[] | null = null;
if (categoryIds.length > 0) {
  for (const cid of categoryIds) {
    const { data: links, error: linkErr } = await supabase
      .from('product_categories')
      .select('product_id')
      .eq('category_id', cid);
    if (linkErr) {
      console.error('[products.GET category]', linkErr);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to filter by category');
    }
    const ids = new Set((links ?? []).map((r) => r.product_id as string));
    restrictedIds = restrictedIds == null ? [...ids] : restrictedIds.filter((id) => ids.has(id));
    if (restrictedIds.length === 0) break;
  }
}
if (restrictedIds && restrictedIds.length === 0) {
  return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
}
```

Następnie zarówno do count query jak main query dorzucić `.in('id', restrictedIds)` gdy `restrictedIds != null`.

> Uwaga DRY: ten sam pattern powtórzy się dla tagów (Task 6). Po dodaniu obu, jeśli ciało endpointu robi się ciężkie, wyciągamy `applyMembershipFilter(supabase, table, junctionTable, ids)` do `filters.ts`. Pierwszy raz NIE wyciągamy (KISS — czekamy aż będą 2 użycia → wtedy refactor). Spodziewamy się refactoru w Task 6.

- [ ] **Step 4: Test pass**

```bash
bun run test:api -- products.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/app/api/v1/products/route.ts \
        admin-panel/src/lib/api/filters.ts \
        admin-panel/tests/api/products.test.ts \
        admin-panel/tests/api/setup.ts
git commit -m "feat(api): filter products by category id or slug"
```

---

## Part C — Tags CRUD

### Task 5: Tags DTO + list + create

**Files:**
- Create: `admin-panel/src/lib/api/dto/tag.ts`
- Create: `admin-panel/src/app/api/v1/tags/route.ts`
- Create: `admin-panel/tests/api/tags.test.ts`
- Modify: `admin-panel/tests/api/setup.ts` — `cleanup({ tags })` support.

Tabela `seller_main.tags` ma `slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-zA-Z0-9_-]+$' AND length(slug) BETWEEN 1 AND 50)` i `name TEXT NOT NULL CHECK (length(name) <= 50)`. Public view `public.tags` z `security_invoker = on`. Reuse istniejących `API_SCOPES.PRODUCTS_READ` / `PRODUCTS_WRITE` (tagi są częścią modelu produktu, brak osobnego scope dla TYLKO tags = mniejsza powierzchnia).

- [ ] **Step 1: Failing tests**

```ts
// admin-panel/tests/api/tags.test.ts
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { get, post, patch, del, cleanup, deleteTestApiKey, API_URL } from './setup';

interface Tag { id: string; name: string; slug: string; created_at: string; }
interface ApiResp<T> { data?: T; error?: { code: string; message: string }; pagination?: { has_more: boolean; limit: number; next_cursor: string | null; }; }

const uniqueSlug = () => `tag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

describe('Tags API v1', () => {
  const created: string[] = [];
  afterAll(async () => {
    await cleanup({ tags: created });
    await deleteTestApiKey();
  });

  describe('Auth', () => {
    it('returns 401 unauthenticated', async () => {
      const res = await fetch(`${API_URL}/api/v1/tags`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/tags', () => {
    it('lists tags with pagination', async () => {
      const { status, data } = await get<ApiResp<Tag[]>>('/api/v1/tags?limit=5');
      expect(status).toBe(200);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.pagination?.limit).toBe(5);
    });

    it('filters by search', async () => {
      const slug = uniqueSlug();
      const r = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'ZUnique', slug });
      created.push(r.data.data!.id);
      const { data } = await get<ApiResp<Tag[]>>('/api/v1/tags?search=ZUnique');
      expect(data.data!.some((t) => t.slug === slug)).toBe(true);
    });
  });

  describe('POST /api/v1/tags', () => {
    it('creates a tag', async () => {
      const slug = uniqueSlug();
      const { status, data } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'New', slug });
      expect(status).toBe(201);
      expect(data.data!.slug).toBe(slug);
      created.push(data.data!.id);
    });
    it('rejects duplicate slug with 409', async () => {
      const slug = uniqueSlug();
      const a = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Dup', slug });
      created.push(a.data.data!.id);
      const b = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Dup2', slug });
      expect(b.status).toBe(409);
      expect(b.data.error?.code).toBe('CONFLICT');
    });
    it('rejects invalid slug', async () => {
      const { status, data } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'X', slug: 'has space' });
      expect(status).toBe(400);
      expect(data.error?.code).toBe('VALIDATION_ERROR');
    });
    it('rejects name longer than 50 chars', async () => {
      const { status } = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'x'.repeat(51), slug: uniqueSlug() });
      expect(status).toBe(400);
    });
  });
});
```

Update `tests/api/setup.ts` cleanup:
```ts
// W cleanup() funkcji dodaj:
if (opts.tags?.length) {
  await supabase.from('tags').delete().in('id', opts.tags);
}
```

- [ ] **Step 2: DTO**

```ts
// admin-panel/src/lib/api/dto/tag.ts
import { z } from 'zod';

const TAG_SLUG_RE = /^[a-zA-Z0-9_-]+$/;

export const TagCreateDTO = z
  .object({
    name: z.string().trim().min(1).max(50),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(50)
      .refine((s) => TAG_SLUG_RE.test(s), 'slug must match ^[a-zA-Z0-9_-]+$'),
  })
  .strict();

export const TagUpdateDTO = TagCreateDTO.partial();

export type TagCreateInput = z.infer<typeof TagCreateDTO>;
export type TagUpdateInput = z.infer<typeof TagUpdateDTO>;

export const TAG_API_FIELDS = 'id, name, slug, created_at';
```

- [ ] **Step 3: Route list+create**

```ts
// admin-panel/src/app/api/v1/tags/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreFlight, jsonResponse, apiError, authenticate, handleApiError,
  parseJsonBody, ApiValidationError, successResponse, parseLimit,
  createPaginationResponse, applyCursorToQuery, validateCursor, API_SCOPES,
} from '@/lib/api';
import { TagCreateDTO, TAG_API_FIELDS } from '@/lib/api/dto/tag';
import { escapeIlikePattern } from '@/lib/validations/product';

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const sp = request.nextUrl.searchParams;
    const cursor = sp.get('cursor');
    const limit = parseLimit(sp.get('limit'));
    const search = sp.get('search') ?? '';
    const sortBy = 'created_at';
    const sortOrder = sp.get('sort_order') === 'asc' ? 'asc' : 'desc';

    const cursorErr = validateCursor(cursor);
    if (cursorErr) return apiError(request, 'INVALID_INPUT', cursorErr);
    if (search.length > 200) return apiError(request, 'INVALID_INPUT', 'Search must be 200 chars or less');
    const esc = search ? escapeIlikePattern(search) : null;

    let countQ = supabase.from('tags').select('id', { count: 'exact', head: true });
    if (esc) countQ = countQ.or(`name.ilike.%${esc}%,slug.ilike.%${esc}%`);
    const { count } = await countQ;

    let q = supabase.from('tags').select(TAG_API_FIELDS);
    if (esc) q = q.or(`name.ilike.%${esc}%,slug.ilike.%${esc}%`);
    q = applyCursorToQuery(q, cursor, sortBy, sortOrder);
    q = q.order(sortBy, { ascending: sortOrder === 'asc' })
         .order('id', { ascending: sortOrder === 'asc' })
         .limit(limit + 1);

    const { data, error } = await q;
    if (error) {
      console.error('[tags.GET]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch tags');
    }
    const { items, pagination } = createPaginationResponse(data ?? [], limit, sortBy, sortOrder, cursor);
    return jsonResponse(successResponse(items, { ...pagination, total: count ?? undefined }), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const body = await parseJsonBody<Record<string, unknown>>(request);
    let input;
    try {
      input = TagCreateDTO.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }

    const { data: existing } = await supabase.from('tags').select('id').eq('slug', input.slug).maybeSingle();
    if (existing) return apiError(request, 'CONFLICT', 'Tag slug already exists');

    const { data, error } = await supabase.from('tags').insert(input).select(TAG_API_FIELDS).single();
    if (error) {
      console.error('[tags.POST]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to create tag');
    }
    return jsonResponse(successResponse(data), request, 201);
  } catch (e) { return handleApiError(e, request); }
}
```

- [ ] **Step 4: Tests pass**

```bash
bun run test:api -- tags.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/api/dto/tag.ts \
        admin-panel/src/app/api/v1/tags/route.ts \
        admin-panel/tests/api/tags.test.ts \
        admin-panel/tests/api/setup.ts
git commit -m "feat(api): add v1 tags list and create endpoints"
```

---

### Task 6: Tags single CRUD `GET/PATCH/DELETE /api/v1/tags/[id]`

**Files:**
- Create: `admin-panel/src/app/api/v1/tags/[id]/route.ts`
- Modify: `admin-panel/tests/api/tags.test.ts` — append single-resource tests.

- [ ] **Step 1: Failing tests** (dodaj do tags.test.ts)

```ts
describe('Single tag', () => {
  let id: string;
  beforeAll(async () => {
    const r = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Single', slug: uniqueSlug() });
    id = r.data.data!.id;
    created.push(id);
  });

  it('GET returns tag by id', async () => {
    const r = await get<ApiResp<Tag>>(`/api/v1/tags/${id}`);
    expect(r.status).toBe(200);
    expect(r.data.data!.id).toBe(id);
  });
  it('GET unknown id returns 404', async () => {
    const r = await get<ApiResp<Tag>>('/api/v1/tags/00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(404);
  });
  it('GET invalid uuid returns 400', async () => {
    const r = await get<ApiResp<Tag>>('/api/v1/tags/not-a-uuid');
    expect(r.status).toBe(400);
  });
  it('PATCH updates name', async () => {
    const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, { name: 'Renamed' });
    expect(r.status).toBe(200);
    expect(r.data.data!.name).toBe('Renamed');
  });
  it('PATCH with empty body returns 400', async () => {
    const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, {});
    expect(r.status).toBe(400);
  });
  it('PATCH to existing slug returns 409', async () => {
    const other = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Other', slug: uniqueSlug() });
    created.push(other.data.data!.id);
    const r = await patch<ApiResp<Tag>>(`/api/v1/tags/${id}`, { slug: other.data.data!.slug });
    expect(r.status).toBe(409);
  });
  it('DELETE removes the tag', async () => {
    const tmp = await post<ApiResp<Tag>>('/api/v1/tags', { name: 'Del', slug: uniqueSlug() });
    const tmpId = tmp.data.data!.id;
    const r = await del<ApiResp<unknown>>(`/api/v1/tags/${tmpId}`);
    expect(r.status).toBe(204);
    const after = await get<ApiResp<Tag>>(`/api/v1/tags/${tmpId}`);
    expect(after.status).toBe(404);
  });
});
```

- [ ] **Step 2: Implementacja**

```ts
// admin-panel/src/app/api/v1/tags/[id]/route.ts
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  handleCorsPreFlight, jsonResponse, noContentResponse, apiError, authenticate,
  handleApiError, parseJsonBody, ApiValidationError, successResponse, API_SCOPES,
} from '@/lib/api';
import { validateUUID } from '@/lib/validations/product';
import { TagUpdateDTO, TAG_API_FIELDS } from '@/lib/api/dto/tag';

interface RouteParams { params: Promise<{ id: string }>; }

export async function OPTIONS(request: NextRequest) { return handleCorsPreFlight(request); }

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_READ]);
    const { id } = await params;
    if (!validateUUID(id)) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');
    const { data, error } = await supabase.from('tags').select(TAG_API_FIELDS).eq('id', id).single();
    if (error) {
      if (error.code === 'PGRST116') return apiError(request, 'NOT_FOUND', 'Tag not found');
      console.error('[tags.GET single]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to fetch tag');
    }
    return jsonResponse(successResponse(data), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;
    if (!validateUUID(id)) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');

    const body = await parseJsonBody<Record<string, unknown>>(request);
    let input;
    try {
      input = TagUpdateDTO.parse(body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        throw new ApiValidationError('Validation failed', {
          _errors: err.issues.map((i) => `${i.path.join('.') || '_'}: ${i.message}`),
        });
      }
      throw err;
    }
    if (Object.keys(input).length === 0) return apiError(request, 'INVALID_INPUT', 'No fields to update');

    if (input.slug) {
      const { data: dup } = await supabase.from('tags').select('id').eq('slug', input.slug).neq('id', id).maybeSingle();
      if (dup) return apiError(request, 'CONFLICT', 'Tag slug already exists');
    }

    const { data, error } = await supabase.from('tags').update(input).eq('id', id).select(TAG_API_FIELDS).single();
    if (error) {
      if (error.code === 'PGRST116') return apiError(request, 'NOT_FOUND', 'Tag not found');
      console.error('[tags.PATCH]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to update tag');
    }
    return jsonResponse(successResponse(data), request);
  } catch (e) { return handleApiError(e, request); }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { supabase } = await authenticate(request, [API_SCOPES.PRODUCTS_WRITE]);
    const { id } = await params;
    if (!validateUUID(id)) return apiError(request, 'INVALID_INPUT', 'Invalid tag ID');
    const { error } = await supabase.from('tags').delete().eq('id', id);
    if (error) {
      console.error('[tags.DELETE]', error);
      return apiError(request, 'INTERNAL_ERROR', 'Failed to delete tag');
    }
    return noContentResponse(request);
  } catch (e) { return handleApiError(e, request); }
}
```

ON DELETE CASCADE w `product_tags` (FK do `seller_main.tags`) usuwa powiązania automatycznie — nie musimy ręcznie czyścić junction.

- [ ] **Step 3: Tests pass**

```bash
bun run test:api -- tags.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add admin-panel/src/app/api/v1/tags/'[id]'/route.ts admin-panel/tests/api/tags.test.ts
git commit -m "feat(api): add v1 single-tag CRUD"
```

---

## Part D — Filter products by tag + write tag assignments

### Task 7: Refactor membership filter helper (DRY), filter `?tag=` w GET /products

**Files:**
- Modify: `admin-panel/src/lib/api/filters.ts` — wyciągnąć `applyMembershipFilter`.
- Modify: `admin-panel/src/app/api/v1/products/route.ts` — wymienić inline category code na helper + dorzucić tag.
- Modify: `admin-panel/tests/api/products.test.ts` — testy filter by tag.

Drugie użycie tego samego patternu = refactor zgodnie z DRY (Task 4 zaznaczyło, że refactor pojawia się tutaj — celowy YAGNI we wcześniejszym kroku).

- [ ] **Step 1: Failing tests for ?tag=**

```ts
// W products.test.ts dodać describe block analogiczny do category:
describe('GET /api/v1/products ?tag= filter', () => {
  let tagA: string, tagB: string, tagASlug: string;
  let pA: string, pB: string, pBoth: string;

  beforeAll(async () => {
    tagASlug = `tag-a-${Date.now()}`;
    const r1 = await post<ApiResp<{ id: string }>>('/api/v1/tags', { name: 'A', slug: tagASlug });
    const r2 = await post<ApiResp<{ id: string }>>('/api/v1/tags', { name: 'B', slug: `tag-b-${Date.now()}` });
    tagA = r1.data.data!.id; tagB = r2.data.data!.id;

    const make = async (tags: string[]) => {
      const { data } = await post<ApiResp<{ id: string }>>('/api/v1/products', {
        name: 'TF', slug: uniqueSlug(), description: 'd', price: 1, tags,
      });
      createdProductIds.push(data.data!.id);
      return data.data!.id;
    };
    pA = await make([tagA]); pB = await make([tagB]); pBoth = await make([tagA, tagB]);
  });

  afterAll(async () => {
    await supabaseAdmin().from('tags').delete().in('id', [tagA, tagB]);
  });

  it('filters by tag UUID', async () => {
    const { data } = await get<ApiResp<Array<{ id: string }>>>(`/api/v1/products?tag=${tagA}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining([pA, pBoth]));
    expect(ids).not.toContain(pB);
  });
  it('filters by tag slug', async () => {
    const { data } = await get<ApiResp<Array<{ id: string }>>>(`/api/v1/products?tag=${tagASlug}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toContain(pA);
  });
  it('AND-intersects ?tag=a,b', async () => {
    const { data } = await get<ApiResp<Array<{ id: string }>>>(`/api/v1/products?tag=${tagA},${tagB}&limit=100`);
    const ids = data.data!.map((p) => p.id);
    expect(ids).toContain(pBoth);
    expect(ids).not.toContain(pA);
    expect(ids).not.toContain(pB);
  });
  it('combines ?category= AND ?tag= (AND across dimensions)', async () => {
    // Reuse existing category infrastructure from Task 4 describe block — needs ids exposed.
    // If exposed: assert intersection. If not: skip with .skip and note for future.
  });
});
```

- [ ] **Step 2: Run failing** — tag param ignored.

- [ ] **Step 3: Refactor — wyciągnij `applyMembershipFilter` do `filters.ts`**

```ts
// W admin-panel/src/lib/api/filters.ts dorzuć:
import type { SupabaseClient } from '@supabase/supabase-js';

export interface MembershipFilterConfig {
  /** Junction table, e.g. 'product_categories' or 'product_tags' */
  junctionTable: string;
  /** Column in junction holding the id we filter against, e.g. 'category_id' */
  fkColumn: string;
}

/**
 * Returns the AND-intersection set of product ids matching all given category/tag ids,
 * or null when the parsed slugs could not be resolved (no products match).
 */
export async function intersectProductIdsByMembership(
  supabase: SupabaseClient,
  ids: string[],
  cfg: MembershipFilterConfig,
): Promise<string[] | null> {
  if (ids.length === 0) return null;  // no filter applied
  let acc: string[] | null = null;
  for (const id of ids) {
    const { data, error } = await supabase
      .from(cfg.junctionTable)
      .select('product_id')
      .eq(cfg.fkColumn, id);
    if (error) throw error;
    const matched = new Set((data ?? []).map((r) => r.product_id as string));
    acc = acc == null ? [...matched] : acc.filter((pid) => matched.has(pid));
    if (acc.length === 0) return [];
  }
  return acc;
}
```

W GET /products zamień inline category code na:

```ts
const categoryFilter = safeParse(searchParams.get('category'), 'category', request);
if (categoryFilter instanceof Response) return categoryFilter;
const tagFilter = safeParse(searchParams.get('tag'), 'tag', request);
if (tagFilter instanceof Response) return tagFilter;

const categoryIds = await resolveFilterIds(supabase, 'categories', categoryFilter);
const tagIds = await resolveFilterIds(supabase, 'tags', tagFilter);
if (categoryIds === null || tagIds === null) {
  return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
}

const categoryProductIds = categoryIds.length
  ? await intersectProductIdsByMembership(supabase, categoryIds, { junctionTable: 'product_categories', fkColumn: 'category_id' })
  : null;
const tagProductIds = tagIds.length
  ? await intersectProductIdsByMembership(supabase, tagIds, { junctionTable: 'product_tags', fkColumn: 'tag_id' })
  : null;

const filteredIds = intersectNullable(categoryProductIds, tagProductIds);
if (filteredIds && filteredIds.length === 0) {
  return jsonResponse(successResponse([], { cursor: null, next_cursor: null, has_more: false, limit, total: 0 }), request);
}
```

Dodaj lokalne helpery w pliku route (małe, single-use → KISS, NIE wynosimy):

```ts
function safeParse(raw: string | null, label: string, request: NextRequest) {
  try { return parseCsvFilter(raw); }
  catch (e) { return apiError(request, 'INVALID_INPUT', e instanceof Error ? e.message : `Invalid ${label}`); }
}

function intersectNullable(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}
```

W `count` i `query` chains dodaj na końcu (przed `.order`):
```ts
if (filteredIds) query = query.in('id', filteredIds);
if (filteredIds) countQuery = countQuery.in('id', filteredIds);
```

- [ ] **Step 4: Tests pass**

```bash
bun run test:api -- products.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add admin-panel/src/lib/api/filters.ts \
        admin-panel/src/app/api/v1/products/route.ts \
        admin-panel/tests/api/products.test.ts
git commit -m "feat(api): filter products by tag id or slug, DRY membership filter"
```

---

### Task 8: Tag assignment w POST/PATCH /api/v1/products (`tags: string[]`)

**Files:**
- Modify: `admin-panel/src/lib/api/dto/product.ts` — dorzucić `tags`.
- Modify: `admin-panel/src/app/api/v1/products/route.ts` — POST handler wstawia linki do `product_tags` (best-effort).
- Modify: `admin-panel/src/app/api/v1/products/[id]/route.ts` — PATCH replace-semantics dla tags (lustro dla categories — sprawdzić istniejący kod, mirror dokładnie).
- Modify: `admin-panel/tests/api/products.test.ts` — testy create/update z tagami.

- [ ] **Step 1: Failing tests**

```ts
describe('POST/PATCH /api/v1/products tags array', () => {
  let tagId: string;
  beforeAll(async () => {
    const r = await post<ApiResp<{ id: string }>>('/api/v1/tags', { name: 'Assign', slug: `assign-${Date.now()}` });
    tagId = r.data.data!.id;
  });
  afterAll(async () => {
    await supabaseAdmin().from('tags').delete().eq('id', tagId);
  });

  it('POST stores tags links and returns them via embed', async () => {
    const slug = uniqueSlug();
    const { status, data } = await post<ApiResp<{ id: string }>>('/api/v1/products', {
      name: 'WT', slug, description: 'd', price: 1, tags: [tagId],
    });
    expect(status).toBe(201);
    createdProductIds.push(data.data!.id);

    const got = await get<ApiResp<{ tags: Array<{ id: string }> }>>(`/api/v1/products/${data.data!.id}`);
    expect(got.data.data!.tags.map((t) => t.id)).toContain(tagId);
  });

  it('PATCH replaces existing tags (full replace semantics)', async () => {
    const slug = uniqueSlug();
    const r = await post<ApiResp<{ id: string }>>('/api/v1/products', {
      name: 'PT', slug, description: 'd', price: 1, tags: [tagId],
    });
    const pid = r.data.data!.id;
    createdProductIds.push(pid);

    await patch<ApiResp<unknown>>(`/api/v1/products/${pid}`, { tags: [] });
    const after = await get<ApiResp<{ tags: unknown[] }>>(`/api/v1/products/${pid}`);
    expect(after.data.data!.tags).toEqual([]);
  });

  it('POST rejects >50 tags', async () => {
    const slug = uniqueSlug();
    const bogus = Array.from({ length: 51 }, () => crypto.randomUUID());
    const { status } = await post<ApiResp<unknown>>('/api/v1/products', {
      name: 'TooMany', slug, description: 'd', price: 1, tags: bogus,
    });
    expect(status).toBe(400);
  });

  it('POST rejects non-UUID in tags array', async () => {
    const slug = uniqueSlug();
    const { status } = await post<ApiResp<unknown>>('/api/v1/products', {
      name: 'Bad', slug, description: 'd', price: 1, tags: ['not-a-uuid'],
    });
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: Dodaj `tags` do DTO**

```ts
// admin-panel/src/lib/api/dto/product.ts — w baseShape dorzuć:
tags: z.array(z.string().uuid()).max(50).optional(),
```

- [ ] **Step 3: POST handler — wstaw linki**

Najpierw przejrzeć kod jak istniejący POST obsługuje `categories` (`admin-panel/src/app/api/v1/products/route.ts` — sekcja po `mapApiInputToProductRow`). Mirror dokładnie dla `tags`:

```ts
// Po wyciągnięciu body.categories, dorzuć:
const { categories, tags, ...productDataRaw } = body;

// Po insertcie produktu i po sekcji categories link (lub jeśli nie ma — utworzyć ją analogicznie), dodaj:
if (Array.isArray(tags) && tags.length > 0) {
  const tagRows = tags.map((tag_id) => ({ product_id: product.id, tag_id }));
  const { error: tagLinkErr } = await supabase.from('product_tags').insert(tagRows);
  if (tagLinkErr) {
    console.error('[products.POST tags link]', tagLinkErr);
    // best-effort: produkt powstał, tagi nie — zwracamy 201 z metadata
  }
}
```

Sprawdzić w istniejącym kodzie czy categories są obsługiwane analogicznie i wzorować się 1:1 (jeśli categories są wstawiane w transakcji RPC, tagi również w analogicznej; jeśli osobno — osobno).

- [ ] **Step 4: PATCH handler — replace semantics**

```ts
// W admin-panel/src/app/api/v1/products/[id]/route.ts PATCH, po update produktu:
if (Array.isArray(tags)) {
  await supabase.from('product_tags').delete().eq('product_id', id);
  if (tags.length > 0) {
    const { error: linkErr } = await supabase.from('product_tags').insert(
      tags.map((tag_id) => ({ product_id: id, tag_id }))
    );
    if (linkErr) {
      console.error('[products.PATCH tags link]', linkErr);
    }
  }
}
```

Wyciągnij `tags` z body wcześniej (analogicznie do `categories`).

- [ ] **Step 5: Tests pass**

```bash
bun run test:api -- products.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add admin-panel/src/lib/api/dto/product.ts \
        admin-panel/src/app/api/v1/products/route.ts \
        admin-panel/src/app/api/v1/products/'[id]'/route.ts \
        admin-panel/tests/api/products.test.ts
git commit -m "feat(api): accept tags array on product create/update with replace semantics"
```

---

## Part E — Final verification

### Task 9: Full check + opportunistic cleanup

- [ ] **Step 1: Typecheck**

```bash
cd admin-panel && bun run typecheck
```
Expected: 0 errors.

- [ ] **Step 2: Lint**

```bash
bun run lint
```
Expected: 0 warnings, 0 errors.

- [ ] **Step 3: Unit tests**

```bash
bun run test:unit
```
Expected: ALL pass (existing + new embed + filters tests).

- [ ] **Step 4: API integration tests**

```bash
bun run test:api
```
Expected: ALL pass (existing + new tags + filter tests).

- [ ] **Step 5: Build**

```bash
bun run build
```
Expected: build OK.

- [ ] **Step 6: Unused exports / dead code scan**

Z poziomu admin-panel:
```bash
grep -rn "validateUUID\|TAG_API_FIELDS\|parseCsvFilter\|parseEmbed" src tests | head -40
```
Each new export should appear in test + route file at minimum. Brak orphaned exports.

- [ ] **Step 7: Scan logs for sensitive data leakage**

Sprawdzić nowe console.error linie:
```bash
grep -rn "console.error" src/app/api/v1/tags src/app/api/v1/products src/lib/api/embed.ts src/lib/api/filters.ts
```
Każdy log powinien używać `[functionName]` tag prefix (per AGENTS.md) i NIE wypisywać surowych body/query/secrets.

- [ ] **Step 8: Final commit jeśli polish potrzebny**

```bash
git status
# Jeśli są zmiany cleanup — commit jako:
git commit -m "chore(api): polish logs and remove dead imports"
```

### Task 10: Open PR (manual user step)

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/products-filtering-tags-crud
```

- [ ] **Step 2: User otwiera PR ręcznie**

Tytuł sugerowany: `feat(api): filter products by category/tag and add tags CRUD`

Body (sugestia — user korekuje):
- 3 capabilities: category filter, tag filter, tags CRUD.
- Zero migrations (uses existing seller_main.tags + product_tags).
- Embed opt-in (`?embed=categories,tags`).
- All new endpoints unit + integration tested.

---

## Self-review

**Spec coverage** (per user message):
| Wymaganie | Tasks |
|---|---|
| Pobieranie produktów po kategorii | 4 |
| Cały CRUD tagów (list+single+create+update+delete) | 5, 6 |
| Pobieranie produktów po tagu | 7 |
| (bonus) Tag assignment przez products endpoint | 8 |
| (bonus) Embed mechanism dla relations | 1, 3 |
| Zero nowych migracji | confirmed in pre-flight (Task 0, Step 3) |
| Auto-detect UUID/slug | 2 |
| AND intersection dla multiple | 4, 7 |
| Opt-in embed (no breaking change) | 1, 3 |

**Placeholder scan:** none — every code step contains concrete TypeScript.

**Type consistency:**
- `parseEmbed` → `Set<EmbedKey>` (used by `buildProductSelect`, `transformEmbeddedRelations` consumers).
- `parseCsvFilter` → `ParsedFilter { ids; slugs }` (used by `resolveFilterIds`).
- `resolveFilterIds` → `string[] | null` (null = unresolved slug = empty result).
- `intersectProductIdsByMembership` → `string[] | null` (null = no filter; `[]` = filter matched nothing).
- `intersectNullable` chains the two correctly.

**Open items left for user:**
- Czy chcesz Bruno requesty (`bruno/v1-tags.bru`, `v1-products-filtered.bru`)? Nie wszedłem — jeśli tak, dodaj po ostatnim commicie analogicznie do istniejących plików.
- Po merge: rotacja dokumentacji API (`AGENTS.md` "API endpoints" jeśli jest lista) — jednolinijkowe wpisy o nowych endpointach.
