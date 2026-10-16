/** Release-shipped storefront definitions. @see spec/contracts/template-recipe.md */
import { configSchema, recipeSchema } from '@/lib/storefront-templates/schemas';
import { CONFIG_BYTES, isPlainJson, pointer, result, storedJsonBytes } from '@/lib/storefront-templates/json';
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { SECTION_DESCRIPTORS } from '@/lib/storefront-templates/section-descriptors';
import { D_TOKENS } from '@/lib/storefront-templates/fixtures';
import type { ZodIssue } from 'zod';
import type { SlotContent, StorefrontConfig, TemplateRegistryEntry } from '@/lib/storefront-templates/schemas';
import type { ValidationIssue, ValidationResult } from '@/lib/storefront-templates/json';
import { version } from '../../../package.json';

export const CORE_SETTINGS = { density: { default: 'comfortable', values: ['comfortable', 'compact'] } } as const;
export const STOREFRONT_TEMPLATES = {
  default: {
    sectionDescriptors: SECTION_DESCRIPTORS.default,
    id: 'default', label: { en: 'Default', pl: 'Domyślny' }, minSellf: version, entitlement: { kind: 'free' }, tokens: null, settings: [],
    defaults: { format: 1, surface: 'storefront', shell: 'store/1', sections: [
      { id: 'catalogue', type: 'catalogue/1', variant: 'default-groups', source: 'listed-products', filters: ['category', 'price-kind', 'format'], pageSize: 12, density: { setting: 'density' } },
    ] },
  },
  d: {
    sectionDescriptors: SECTION_DESCRIPTORS.d,
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
} satisfies Record<'default' | 'd', TemplateRegistryEntry>;

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
    if (section.type === 'task-nav/1' && !parsed.data.sections.some(target => target.id === section.target && target.type === 'catalogue/1')) errors.push({ code: 'BINDING', path: `/sections/${index}/target`, message: 'Target must be a declared catalogue' });
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
  const layout = effectiveLayout(STOREFRONT_TEMPLATES[parsed.data.templateId], parsed.data.overridesByTemplate[parsed.data.templateId]);
  const hasContent = (content: SlotContent | undefined): boolean => {
    if (!content) return false;
    if (content.kind === 'faq') return content.items.some(item => item.question.trim() || item.answer.trim());
    return Boolean(content.heading.trim() || content.body.trim() || (content.kind === 'hero' && (content.eyebrow.trim() || content.steps.some(step => step.trim()))));
  };
  for (const section of layout.recipe.sections) {
    if (!('content' in section) || !section.content) continue;
    const id = section.content.slot;
    const slot = parsed.data.content[id];
    if (!hasContent(slot?.en) && !hasContent(slot?.pl)) warnings.push({ code: 'CONTENT_MISSING', path: pointer(['content', id]), message: 'Visible section has no content in any locale' });
  }
  for (const field of ['heroProduct', 'closingProduct'] as const) {
    if (parsed.data.templateId === 'd' && !parsed.data.settingsByTemplate.d?.[field]) warnings.push({ code: 'BINDING', path: `/settingsByTemplate/d/${field}`, message: 'Required publication binding is missing' });
  }
  return result([], warnings);
}

export function isResetPath(templateId: string, field: string): boolean {
  if (templateId !== 'default' && templateId !== 'd') return false;
  if (['settings.density', 'overrides.order'].includes(field)) return true;
  const parts = field.split('.');
  if (parts.length === 4 && parts[0] === 'overrides' && parts[1] === 'sections') {
    const section = effectiveLayout(STOREFRONT_TEMPLATES[templateId]).sections.find(section => section.id === parts[2]);
    return Boolean(section && (parts[3] === 'visibility' ? section.descriptor.hideable : parts[3] === 'variant' && section.descriptor.variants.length));
  }
  if (parts.length !== 3) return false;
  const [root, group, leaf] = parts;
  if (root === 'tokens') {
    const tokens = D_TOKENS;
    if (group !== 'light' && group !== 'dark' && group !== 'typography' && group !== 'shapes') return false;
    return Object.hasOwn(tokens[group], leaf);
  }
  return false;
}

/** Materialize explicit authored orders; absent order continues to inherit defaults. */
export function normalizeConfigOrders(config: StorefrontConfig): StorefrontConfig {
  const copy = structuredClone(config);
  for (const templateId of Object.keys(STOREFRONT_TEMPLATES) as StorefrontConfig['templateId'][]) {
    const overrides = copy.overridesByTemplate[templateId];
    if (overrides?.order !== undefined) Object.assign(overrides, { order: effectiveLayout(STOREFRONT_TEMPLATES[templateId], overrides).order });
  }
  return copy;
}
