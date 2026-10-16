/** Authoring diagnostics and current public binding checks. @see lifecycle.ts */
import 'server-only';
import { loadStorefrontBindings } from '@/lib/storefront-templates/catalogue';
import { pointer, result } from '@/lib/storefront-templates/json';
import { CORE_TOKENS, resolvePublicTheme, validateThemeContrast } from '@/lib/storefront-templates/public-theme';
import { STOREFRONT_TEMPLATES, isResetPath, validateConfig } from '@/lib/storefront-templates/registry';
import { resolveSelection } from '@/lib/storefront-templates/resolver';
import { canMutateTemplateConfig } from '@/lib/storefront-templates/rights';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValidationIssue, ValidationResult } from '@/lib/storefront-templates/json';
import type { TemplateRights } from '@/lib/storefront-templates/rights';
import type { StorefrontConfig } from '@/lib/storefront-templates/schemas';
import type { Database, Json } from '@/types/database';

export function inspectTemplate(config: StorefrontConfig, rights: TemplateRights, mode: 'draft' | 'publish') {
  const structural = validateConfig(config);
  const errors = [...structural.errors]; const warnings = [...structural.warnings];
  const issues = mode === 'publish' ? errors : warnings;
  const selection = resolveSelection(config, Object.keys(STOREFRONT_TEMPLATES));
  if (selection.diagnostic) issues.push({ code: 'COMPATIBILITY', path: '/templateId', message: 'Selected composition is unsupported' });
  if (!canMutateTemplateConfig(rights, config, 'publish')) issues.push({ code: 'ENTITLEMENT', path: '', message: 'Current rights do not permit publication' });
  const entry = STOREFRONT_TEMPLATES[selection.templateId];
  const theme = resolvePublicTheme(entry.tokens, config.tokens, true);
  const candidate = structuredClone(entry.tokens ?? CORE_TOKENS);
  for (const group of ['light', 'dark', 'typography', 'shapes'] as const) Object.assign(candidate[group], config.tokens?.[group]);
  const contrast = validateThemeContrast(candidate);
  for (const path of contrast) issues.push({ code: 'CONTRAST', path: pointer(path.split('.')), message: 'Resolved theme does not meet contrast requirements' });
  if (!contrast.length && theme.diagnostics.length) issues.push({ code: 'CONTRAST', path: '/tokens', message: 'Template theme requires fallback' });
  if (mode === 'publish') for (const warning of structural.warnings) if (warning.code === 'BINDING') errors.push(warning);
  const used = new Set<string>(selection.recipe.sections.flatMap(section => 'content' in section ? [section.content.slot] : []));
  return { validation: result(errors, warnings), effectiveTemplateId: resolveSelection(config, rights.availableTemplateIds).templateId,
    effectiveTokens: theme.effective, unusedSlots: Object.keys(config.content).filter(id => !used.has(id)).sort() };
}

/** Existing bounded adapters enforce public/listed/active and scheduled windows in SQL. */
export async function validateActiveBindings(client: SupabaseClient<Database>, config: StorefrontConfig, validation: ValidationResult): Promise<ValidationResult | null> {
  const selection = resolveSelection(config, Object.keys(STOREFRONT_TEMPLATES));
  if (selection.diagnostic || selection.templateId === 'default') return validation;
  const settings = selection.settings;
  const visible = new Set(selection.recipe.sections.map(section => section.id));
  const starters = visible.has('start') ? settings.starterProducts ?? [] : [];
  const categories = visible.has('tasks') ? settings.taskCategories ?? [] : [];
  const loaded = await loadStorefrontBindings(client, { locale: 'en', heroProduct: settings.heroProduct, closingProduct: settings.closingProduct,
    starterProducts: starters, taskCategories: categories, target: 'catalogue' });
  if (!loaded.success) return null;
  const errors = [...validation.errors]; const warnings = [...validation.warnings];
  const issue = (field: string): ValidationIssue => ({ code: 'BINDING', path: `/settingsByTemplate/d/${field}`, message: 'Reference is not currently public and available' });
  if (settings.heroProduct && !loaded.data.hero) errors.push(issue('heroProduct'));
  if (settings.closingProduct && !loaded.data.closing) errors.push(issue('closingProduct'));
  starters.forEach((id, i) => { if (!loaded.data.starters.some(product => product.id === id.toLowerCase())) warnings.push(issue(`starterProducts/${i}`)); });
  categories.forEach((id, i) => { if (!loaded.data.categories.some(category => category.id === id.toLowerCase())) errors.push(issue(`taskCategories/${i}`)); });
  return result(errors, warnings);
}

export function resetTemplateField(config: StorefrontConfig, templateId: StorefrontConfig['templateId'], field: string): StorefrontConfig | null {
  if (!isResetPath(templateId, field) || (field.startsWith('tokens.') && templateId !== config.templateId)) return null;
  const copy = structuredClone(config);
  const [root, group, leaf, property] = field.split('.');
  const path = root === 'tokens' ? ['tokens', group, leaf] : root === 'settings' ? ['settingsByTemplate', templateId, group] : ['overridesByTemplate', templateId, group, ...(leaf ? [leaf] : []), ...(property ? [property] : [])];
  function remove(value: Record<string, unknown>, remaining: string[]): void {
    const [key, ...rest] = remaining;
    if (!rest.length) { delete value[key]; return; }
    const child = value[key];
    if (!child || typeof child !== 'object' || Array.isArray(child)) return;
    remove(child as Record<string, unknown>, rest);
    if ((!['settingsByTemplate', 'overridesByTemplate'].includes(key) && !Object.keys(child).length) || (key === 'tokens' && Object.keys(child).every(k => k === 'format'))) {
      if (key === 'tokens') value[key] = null;
      else delete value[key];
    }
  }
  remove(copy, path);
  return copy;
}

export interface TemplateChange { path: string; kind: 'added' | 'removed' | 'changed'; before: Json; after: Json }
export function diffTemplateConfigs(before: StorefrontConfig, after: StorefrontConfig): TemplateChange[] {
  const changes: TemplateChange[] = [];
  function compare(a: Json | undefined, b: Json | undefined, path: string[]): void {
    if (a === b) return;
    // Empty default entries carry no retained setting or override.
    if (path.length === 2 && ['settingsByTemplate', 'overridesByTemplate'].includes(path[0]) && path[1] === 'default') {
      const empty = (value: Json | undefined) => value === undefined || (value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0);
      if (empty(a) && empty(b)) return;
    }
    if (a !== undefined && b !== undefined && a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) compare((a as Record<string, Json>)[key], (b as Record<string, Json>)[key], [...path, key]);
    } else changes.push({ path: pointer(path), kind: a === undefined ? 'added' : b === undefined ? 'removed' : 'changed', before: a ?? null, after: b ?? null });
  }
  compare(before, after, []);
  return changes.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
