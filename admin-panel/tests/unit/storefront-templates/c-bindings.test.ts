/** Localized C public bindings stay bounded and optional. */
import { beforeEach, expect, it, vi } from 'vitest';
import { collectAuthorBindings } from '@/lib/storefront-templates/author-bindings';
import { validateActiveBindings } from '@/lib/storefront-templates/lifecycle-validation';
import { resolveSelection } from '@/lib/storefront-templates/resolver';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { result } from '@/lib/storefront-templates/json';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { phase2Config, uuid } from '../../fixtures/storefront-sections/phase2/contracts';
const m = vi.hoisted(() => ({ bindings: vi.fn() }));
vi.mock('@/lib/storefront-templates/catalogue', () => ({ loadStorefrontBindings: m.bindings }));
beforeEach(() => m.bindings.mockReset().mockResolvedValue({ success: true, data: { hero: null, closing: null, starters: [], comparison: [], featured: [], paths: {}, mediaById: {}, categories: [] } }));
const config = () => configSchema.parse({ ...phase2Config, templateId: 'storefront-c', content: { ...phase2Config.content,
  'home.paths': { ...phase2Config.content['home.paths'], pl: { ...phase2Config.content['home.paths'].en, items: [{ id: 'polish', productId: uuid(2), situation: 'Start', body: '' }] } },
  'home.author': { sourceLocale: 'en', en: { ...phase2Config.content['home.author'].en, portraitMediaId: uuid(20) } },
} });
it('collects requested locale paths and source-locale portrait once without hidden projects', () => {
  const selection = resolveSelection(config(), ['storefront-c']);
  expect(collectAuthorBindings(selection, 'en')).toEqual({ pathProducts: [uuid(1)], mediaProducts: [uuid(20)] });
  expect(collectAuthorBindings(selection, 'pl')).toEqual({ pathProducts: [uuid(2)], mediaProducts: [uuid(20)] });
  selection.recipe.sections = selection.recipe.sections.filter(section => section.type !== 'author-hero/1' && section.type !== 'project-showcase/1');
  expect(collectAuthorBindings(selection, 'pl')).toEqual({ pathProducts: [uuid(2)], mediaProducts: [] });
});
it('checks both distinct public locale bindings and warns when optional paths or covers are absent', async () => {
  const validation = await validateActiveBindings({} as SupabaseClient<Database>, config(), result([]));
  expect(m.bindings).toHaveBeenCalledTimes(2);
  expect(m.bindings).toHaveBeenCalledWith({}, expect.objectContaining({ locale: 'en', pathProducts: [uuid(1)], mediaProducts: [uuid(20)] }));
  expect(m.bindings).toHaveBeenCalledWith({}, expect.objectContaining({ locale: 'pl', pathProducts: [uuid(2)], mediaProducts: [uuid(20)] }));
  expect(validation).toMatchObject({ valid: true, warnings: expect.arrayContaining([expect.objectContaining({ code: 'BINDING', path: '/content/home.paths/en' }), expect.objectContaining({ code: 'BINDING', path: '/content/home.paths/pl' })]) });
});

it('omits path references rejected by canonical UUID identity validation', () => {
  const selected = resolveSelection(config(), ['storefront-c']);
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const paths = phase2Config.content['home.paths'].en;
  selected.content['home.paths'] = { sourceLocale: 'en', en: { ...paths, items: [
    { ...paths.items[0], id: 'first', productId: id },
    { ...paths.items[0], id: 'second', productId: id.toUpperCase() },
  ] } };
  expect(collectAuthorBindings(selected, 'en').pathProducts).toEqual([]);
});
