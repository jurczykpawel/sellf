/** Repeatable TEST fixtures through API v1 only. @see ./README.md */
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

interface SeedOptions {
  url: string;
  key: string;
  confirmedTest: boolean;
  dryRun?: boolean;
  fetcher?: typeof fetch;
}
interface Row { id: string; [key: string]: unknown }
interface Dataset {
  products: Record<string, unknown>[];
  coupons: Record<string, unknown>[];
  bumps: { main_slug: string; bump_slug: string; bump_title: string; is_active: boolean }[];
}
interface SeedResult { resource: string; name: string; action: 'utworzone' | 'zaktualizowane' | 'bez zmian' }
const BLOCKED_HOSTS = ['sellf.techskills.academy', 'demo.sellf.app'];
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return JSON.stringify(Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  ));
  return JSON.stringify(value);
}
function normalizeSessions(desired: Record<string, unknown>[], current: Record<string, unknown>[], keepIds = false): Record<string, unknown>[] {
  if (!keepIds && current.length !== desired.length) return current;
  return desired.map((entry): Record<string, unknown> => {
    const existing = current.find(row => row.sort === entry.sort);
    const fields = Object.fromEntries(Object.entries(entry).map(([key, value]) => {
      if (key === 'tiers') return [key, normalizeSessions(value as Record<string, unknown>[], (existing?.tiers ?? []) as Record<string, unknown>[], keepIds)];
      const actual = existing?.[key];
      return [key, keepIds ? value : key.endsWith('_at') && typeof actual === 'string' ? new Date(actual).toISOString() : actual];
    }));
    return { ...fields, ...(keepIds && existing?.id ? { id: existing.id } : {}) };
  }).sort((a, b) => Number(a.sort) - Number(b.sort));
}
export async function seedTestEnv(options: SeedOptions): Promise<SeedResult[]> {
  const base = new URL(options.url);
  const host = base.hostname.toLowerCase().replace(/\.+$/, '');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('SELLF_URL musi być adresem głównym HTTP(S).');
  if (BLOCKED_HOSTS.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error('Odmowa: domena produkcyjna/demo.');
  if (!options.confirmedTest) throw new Error('API v1 nie ujawnia trybu Stripe. Wymagana flaga --i-know-this-is-test.');
  if (!options.key) throw new Error('Brak SELLF_API_KEY.');
  const dataset: Dataset = JSON.parse(await readFile(new URL('./test-env-dataset.json', import.meta.url), 'utf8'));
  const fetcher = options.fetcher ?? fetch;
  async function request(path: string, method = 'GET', body?: Record<string, unknown>) {
    const response = await fetcher(new URL(`/api/v1/${path}`, base), {
      method, redirect: 'error', signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${options.key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok || response.status === 207) throw new Error(`API ${method} ${path.split('?')[0]}: HTTP ${response.status}`);
    return await response.json() as { data: Row | Row[]; pagination?: { has_more: boolean; next_cursor: string | null } };
  }
  async function list(resource: string): Promise<Row[]> {
    const rows: Row[] = [];
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: '100', ...(resource === 'products' ? { status: 'all' } : {}), ...(cursor ? { cursor } : {}) });
      const page = await request(`${resource}?${query}`);
      if (!Array.isArray(page.data)) throw new Error(`Niepoprawna lista: ${resource}`);
      rows.push(...page.data);
      cursor = page.pagination?.has_more ? page.pagination.next_cursor : null;
      if (page.pagination?.has_more && (!cursor || seen.has(cursor))) throw new Error(`Niepoprawna paginacja: ${resource}`);
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }
  const products = await list('products');
  const coupons = await list('coupons');
  const bumps = await list('order-bumps');
  const results: SeedResult[] = [];
  async function upsert(resource: string, desired: Record<string, unknown>, matches: Row[], name: string): Promise<Row> {
    if (matches.length > 1) throw new Error(`Niejednoznaczny wpis: ${resource}/${name}`);
    const current = matches[0];
    const sessions = desired.sessions as Record<string, unknown>[] | undefined;
    const existingSessions = (current?.sessions ?? []) as Record<string, unknown>[];
    const comparable = current && sessions ? { ...current, sessions: normalizeSessions(sessions, existingSessions) } : current;
    const changes = Object.fromEntries(Object.entries(desired).filter(([key, value]) => !comparable || canonical(comparable[key]) !== canonical(key === 'sessions' && sessions ? normalizeSessions(sessions, sessions) : value)));
    if (sessions && existingSessions.length !== sessions.length) changes.sessions = sessions;
    const changed = Object.keys(changes).length > 0;
    results.push({ resource, name, action: !current ? 'utworzone' : changed ? 'zaktualizowane' : 'bez zmian' });
    if (options.dryRun || !changed) return current ?? { ...desired, id: `dry:${name}` };
    // Product API validates recurring configuration as a complete group.
    const body = resource === 'products' ? { ...desired, ...(sessions ? { sessions: normalizeSessions(sessions, existingSessions, true) } : {}) } : changes;
    const response = await request(`${resource}${current ? `/${encodeURIComponent(current.id)}` : ''}`, current ? 'PATCH' : 'POST', body);
    if (Array.isArray(response.data) || typeof response.data?.id !== 'string') throw new Error(`Niepoprawny zapis: ${resource}`);
    return response.data;
  }
  const ids = new Map<string, string>();
  for (const entry of dataset.products) {
    const desired = { currency: 'PLN', is_active: true, is_listed: false, product_type: 'one_time', ...entry };
    const row = await upsert('products', desired, products.filter(row => row.slug === entry.slug), String(entry.slug));
    ids.set(String(entry.slug), row.id);
  }
  for (const entry of dataset.coupons) await upsert('coupons', entry, coupons.filter(row => row.code === entry.code), String(entry.code));
  for (const { main_slug, bump_slug, ...entry } of dataset.bumps) {
    const main_product_id = ids.get(main_slug);
    const bump_product_id = ids.get(bump_slug);
    if (!main_product_id || !bump_product_id) throw new Error('Brak produktu dla bumpa.');
    await upsert('order-bumps', { ...entry, main_product_id, bump_product_id }, bumps.filter(row => row.main_product_id === main_product_id && row.bump_product_id === bump_product_id), `${main_slug}/${bump_slug}`);
  }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--dry-run', '--i-know-this-is-test'].includes(arg))) {
    console.error('Dozwolone flagi: --dry-run --i-know-this-is-test');
    process.exitCode = 1;
  } else {
    seedTestEnv({ url: process.env.SELLF_URL ?? '', key: process.env.SELLF_API_KEY ?? '', dryRun: args.includes('--dry-run'), confirmedTest: args.includes('--i-know-this-is-test') })
      .then(rows => {
        if (args.includes('--dry-run')) console.log('DRY RUN — plan, bez zapisu');
        console.table(rows);
        console.table(['utworzone', 'zaktualizowane', 'bez zmian'].map(action => ({ wynik: action, liczba: rows.filter(row => row.action === action).length })));
      })
      .catch(() => { console.error('[seedTestEnv] Nie ukończono. Sprawdź adres TEST, flagę, klucz, uprawnienia i dostępność API; zapisane wcześniej wpisy pozostają.'); process.exitCode = 1; });
  }
}
