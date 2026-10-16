/** Shared offline fixture checks; instance publication uses fresh context. @see spec/contracts/validator-cli.md */
import { z } from 'zod';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { pointer, result } from '@/lib/storefront-templates/json';
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { STOREFRONT_TEMPLATES, validateConfig } from '@/lib/storefront-templates/registry';
import type { ValidationIssue, ValidationResult } from '@/lib/storefront-templates/json';

// Only identity and availability participate in offline binding checks.
export const publicCheckFixtureSchema = z.strictObject({
  products: z.array(z.object({ id: z.uuid(), availability: z.enum(['available', 'unavailable']) })).max(72),
  categories: z.array(z.object({ id: z.uuid() })).max(12),
});

export function checkTemplate(input: unknown, mode: 'draft' | 'publish' = 'draft', fixture?: unknown): ValidationResult {
  const validation = validateConfig(input);
  if (!validation.valid) return validation;
  const config = configSchema.parse(input);
  const errors: ValidationIssue[] = [];
  const warnings = [...validation.warnings];
  const issues = mode === 'publish' ? errors : warnings;
  const layout = effectiveLayout(STOREFRONT_TEMPLATES[config.templateId], config.overridesByTemplate[config.templateId]);
  if (!layout.valid) issues.push({ code: 'COMPATIBILITY', path: '/overridesByTemplate', message: 'Selected composition is unsupported' });
  const parsed = fixture === undefined ? undefined : publicCheckFixtureSchema.safeParse(fixture);
  if (parsed && !parsed.success) return result(parsed.error.issues.map(issue => ({ code: 'SCHEMA', path: '/fixture' + pointer(issue.path), message: 'Invalid public fixture' })));
  if (mode === 'publish' && !parsed) errors.push({ code: 'BINDING', path: '', message: 'Offline publish check requires a public fixture' });
  if (mode === 'publish') {
    warnings.push({ code: 'ENTITLEMENT', path: '', message: 'Offline checks do not verify live rights, availability, resolved tokens or publication readiness' });
    for (const warning of validation.warnings) if (warning.code === 'BINDING') errors.push(warning);
  }
  if (parsed?.success && config.templateId === 'd') {
    const settings = config.settingsByTemplate.d;
    const visible = new Set(layout.recipe.sections.map(section => section.id));
    const references: [string, string | undefined, boolean][] = [
      ['heroProduct', settings?.heroProduct, true], ['closingProduct', settings?.closingProduct, true],
      ...(visible.has('start') ? (settings?.starterProducts ?? []).map((id, index): [string, string, boolean] => [`starterProducts/${index}`, id, false]) : []),
    ];
    for (const [field, id, required] of references) {
      if (!id) continue;
      const product = parsed.data.products.find(product => product.id === id);
      const issue: ValidationIssue | undefined = !product
        ? { code: 'BINDING', path: `/settingsByTemplate/d/${field}`, message: 'Product is absent from public fixture' }
        : product.availability !== 'available' ? { code: 'UNAVAILABLE_PRODUCT', path: `/settingsByTemplate/d/${field}`, message: 'Product is unavailable in public fixture' } : undefined;
      if (issue) (required ? issues : warnings).push(issue);
    }
    if (visible.has('tasks')) for (const [index, id] of (settings?.taskCategories ?? []).entries()) {
      if (!parsed.data.categories.some(category => category.id === id)) issues.push({ code: 'BINDING', path: `/settingsByTemplate/d/taskCategories/${index}`, message: 'Category is absent from public fixture' });
    }
  }
  return result(errors, warnings);
}
