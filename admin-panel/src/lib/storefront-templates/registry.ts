/** Release-shipped storefront definitions. @see spec/contracts/template-recipe.md */
import { configSchema, recipeSchema } from '@/lib/storefront-templates/schemas';
import { CONFIG_BYTES, isPlainJson, pointer, result, storedJsonBytes } from '@/lib/storefront-templates/json';
import { A_TOKENS, D_TOKENS } from '@/lib/storefront-templates/fixtures';
import type { ZodIssue } from 'zod';
import type { TemplateRegistryEntry } from '@/lib/storefront-templates/schemas';
import type { ValidationIssue, ValidationResult } from '@/lib/storefront-templates/json';
import { version } from '../../../package.json';

export const CORE_SETTINGS = { density: { default: 'comfortable', values: ['comfortable', 'compact'] } } as const;
export const STOREFRONT_TEMPLATES = {
  default: {
    id: 'default', label: { en: 'Default', pl: 'Domyślny' }, minSellf: version, entitlement: { kind: 'free' }, tokens: null, settings: [],
    defaults: { format: 1, surface: 'storefront', shell: 'store/1', sections: [
      { id: 'catalogue', type: 'catalogue/1', variant: 'default-groups', source: 'listed-products', filters: ['category', 'price-kind', 'format'], pageSize: 12, density: { setting: 'density' } },
    ] },
  },
  d: {
    id: 'd', label: { en: 'Process storefront', pl: 'Sklep z procesem' }, minSellf: version, entitlement: { kind: 'pro' }, tokens: D_TOKENS,
    settings: [
      { id: 'heroProduct', label: { en: 'Featured offer', pl: 'Główna oferta' }, kind: 'product', required: true },
      { id: 'starterProducts', label: { en: 'Three starts', pl: 'Trzy starty' }, kind: 'products', required: false, maxItems: 3 },
      { id: 'taskCategories', label: { en: 'Tasks', pl: 'Zadania' }, kind: 'categories', required: false, maxItems: 12 },
      { id: 'closingProduct', label: { en: 'Closing offer', pl: 'Oferta końcowa' }, kind: 'product', required: true },
      { id: 'density', label: { en: 'Density', pl: 'Gęstość' }, kind: 'density', required: false },
    ],
    defaults: { format: 1, surface: 'storefront', shell: 'store/1', sections: [
      { id: 'hero', type: 'hero-product/1', variant: 'split-process', product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } },
      { id: 'tasks', type: 'task-nav/1', categories: { setting: 'taskCategories' }, content: { slot: 'home.tasks' }, target: 'catalogue' },
      { id: 'start', type: 'product-list/1', variant: 'detail-cards', products: { setting: 'starterProducts' }, content: { slot: 'home.starts' } },
      { id: 'catalogue', type: 'catalogue/1', variant: 'detail-cards', source: 'listed-products', filters: ['category', 'price-kind', 'format'], pageSize: 9, density: { setting: 'density' } },
      { id: 'faq', type: 'faq/1', content: { slot: 'home.faq' } },
      { id: 'closing', type: 'product-cta/1', product: { setting: 'closingProduct' }, content: { slot: 'home.closing' }, action: 'details' },
    ] },
  },
  'storefront-a': {
    id: 'storefront-a', label: { en: 'Offer-led storefront', pl: 'Sklep z główną ofertą' }, minSellf: version,
    entitlement: { kind: 'template-key', templateId: 'storefront-a' }, tokens: A_TOKENS,
    settings: [
      { id: 'heroProduct', label: { en: 'Featured offer', pl: 'Główna oferta' }, kind: 'product', required: true },
      { id: 'comparisonProducts', label: { en: 'Two separate offers', pl: 'Dwie osobne oferty' }, kind: 'products', required: true, maxItems: 2 },
      { id: 'starterProducts', label: { en: 'Three starting points', pl: 'Trzy punkty startowe' }, kind: 'products', required: false, maxItems: 3 },
      { id: 'taskCategories', label: { en: 'Categories', pl: 'Kategorie' }, kind: 'categories', required: false, maxItems: 12 },
      { id: 'density', label: { en: 'Density', pl: 'Gęstość' }, kind: 'density', required: false },
    ],
    defaults: { format: 1, surface: 'storefront', shell: 'store/1', sections: [
      { id: 'hero', type: 'hero-product/1', variant: 'offer-focus', product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } },
      { id: 'tasks', type: 'task-nav/1', categories: { setting: 'taskCategories' }, content: { slot: 'home.tasks' }, target: 'catalogue' },
      { id: 'comparison', type: 'product-list/1', variant: 'comparison', products: { setting: 'comparisonProducts' }, content: { slot: 'home.comparison' } },
      { id: 'start', type: 'product-list/1', variant: 'detail-cards', products: { setting: 'starterProducts' }, content: { slot: 'home.starts' } },
      { id: 'catalogue', type: 'catalogue/1', variant: 'compact', source: 'listed-products', filters: ['category', 'price-kind', 'format'], pageSize: 24, density: { setting: 'density' }, content: { slot: 'home.catalogue' } },
      { id: 'faq', type: 'faq/1', content: { slot: 'home.faq' } },
      { id: 'closing', type: 'product-cta/1', variant: 'catalogue-link', content: { slot: 'home.closing' }, target: 'catalogue' },
    ] },
  },
} satisfies Record<'default' | 'd' | 'storefront-a', TemplateRegistryEntry>;

function schemaErrors(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map(issue => ({
    code: issue.code === 'too_big' || issue.code === 'too_small' ? 'LIMIT' : 'SCHEMA',
    path: pointer(issue.path), message: issue.message,
    ...(issue.code === 'too_big' && typeof issue.maximum === 'number' ? { limit: issue.maximum } : {}),
    ...(issue.code === 'too_small' && typeof issue.minimum === 'number' ? { limit: issue.minimum } : {}),
  }));
}

export function validateRecipe(input: unknown): ValidationResult {
  if (!isPlainJson(input)) return result([{ code: 'SCHEMA', path: '', message: 'Expected plain JSON data' }]);
  const parsed = recipeSchema.safeParse(input);
  if (!parsed.success) return result(schemaErrors(parsed.error.issues));
  const errors: ValidationIssue[] = [];
  const ids = new Set<string>();
  for (const [index, section] of parsed.data.sections.entries()) {
    if (ids.has(section.id)) errors.push({ code: 'SCHEMA', path: `/sections/${index}/id`, message: 'Section IDs must be distinct' });
    ids.add(section.id);
    if ((section.type === 'task-nav/1' || section.type === 'product-cta/1' && 'target' in section) && !parsed.data.sections.some(target => target.id === section.target && target.type === 'catalogue/1')) errors.push({ code: 'BINDING', path: `/sections/${index}/target`, message: 'Target must be a declared catalogue' });
  }
  return result(errors);
}

export function validateConfig(input: unknown): ValidationResult {
  if (!isPlainJson(input)) return result([{ code: 'SCHEMA', path: '', message: 'Expected plain JSON data' }]);
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) return result(schemaErrors(parsed.error.issues));
  const storedSize = storedJsonBytes(parsed.data);
  if (storedSize === null) return result([{ code: 'SCHEMA', path: '', message: 'Unsupported JSON value' }]);
  if (storedSize > CONFIG_BYTES) return result([{ code: 'LIMIT', path: '', message: 'Stored config exceeds byte limit', limit: CONFIG_BYTES }]);
  const warnings: ValidationIssue[] = [];
  for (const [id, slot] of Object.entries(parsed.data.content)) {
    if (!slot.en || !slot.pl) warnings.push({ code: 'TRANSLATION_FALLBACK', path: `/content/${id}`, message: 'Missing translation uses source locale' });
  }
  for (const field of ['heroProduct', 'closingProduct'] as const) {
    if (parsed.data.templateId === 'd' && !parsed.data.settingsByTemplate.d?.[field]) warnings.push({ code: 'BINDING', path: `/settingsByTemplate/d/${field}`, message: 'Required publication binding is missing' });
  }
  if (parsed.data.templateId === 'storefront-a') for (const field of ['heroProduct', 'comparisonProducts'] as const) {
    if (!parsed.data.settingsByTemplate['storefront-a']?.[field]) warnings.push({ code: 'BINDING', path: `/settingsByTemplate/storefront-a/${field}`, message: 'Required publication binding is missing' });
  }
  return result([], warnings);
}

export function isResetPath(templateId: string, field: string): boolean {
  if (!Object.hasOwn(STOREFRONT_TEMPLATES, templateId)) return false;
  if (templateId === 'storefront-a' && !field.startsWith('tokens.') && field !== 'settings.density') return false;
  if (['settings.density', 'overrides.order', 'overrides.hidden'].includes(field)) return true;
  const parts = field.split('.');
  if (parts.length !== 3) return false;
  const [root, group, leaf] = parts;
  if (root === 'tokens') {
    const tokens = D_TOKENS;
    if (group !== 'light' && group !== 'dark' && group !== 'typography' && group !== 'shapes') return false;
    return Object.hasOwn(tokens[group], leaf);
  }
  return root === 'overrides' && group === 'variants' && STOREFRONT_TEMPLATES[templateId as keyof typeof STOREFRONT_TEMPLATES].defaults.sections.some(section => section.id === leaf);
}
