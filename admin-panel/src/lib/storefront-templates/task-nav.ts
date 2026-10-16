/** Task navigation's public resolver and catalogue handoff. @see spec/contracts/section-contract.md */
import { z } from 'zod';
import { headingContentSchema, idSchema, sectionSchema, settingsSchema } from '@/lib/storefront-templates/schemas';
import type { TaskNavProps } from '@/lib/storefront-templates/task-nav-public';
import type { PublicCategoryInfo } from '@/lib/storefront-templates/catalogue';
import type { SlotContent, TemplateRecipe, TemplateSettings } from '@/lib/storefront-templates/schemas';

interface TaskNavInputs {
  locale: 'en' | 'pl'; settings: TemplateSettings;
  categoriesById: Record<string, PublicCategoryInfo>; slots: Record<string, SlotContent>;
}
const categorySchema = z.strictObject({ id: z.uuid(), label: z.string().min(1).refine(v => Array.from(v).length <= 100), filterTarget: idSchema });

export function resolveTaskNav(spec: unknown, inputs: TaskNavInputs, recipe: TemplateRecipe):
  { success: true; data: TaskNavProps } | { success: false; error: 'INVALID' } {
  const parsed = sectionSchema.safeParse(spec);
  const settings = settingsSchema.safeParse(inputs.settings);
  if (!parsed.success || parsed.data.type !== 'task-nav/1' || !settings.success) return { success: false, error: 'INVALID' };
  const section = parsed.data;
  if (!recipe.sections.some(s => s.id === section.target && s.type === 'catalogue/1')) return { success: false, error: 'INVALID' };
  const categories: PublicCategoryInfo[] = [];
  for (const id of settings.data.taskCategories ?? []) {
    if (!Object.hasOwn(inputs.categoriesById, id)) continue;
    const category = categorySchema.safeParse(inputs.categoriesById[id]);
    if (!category.success || category.data.id !== id || category.data.filterTarget !== section.target) return { success: false, error: 'INVALID' };
    categories.push(category.data);
  }
  const slot = inputs.slots[section.content.slot];
  const content = slot === undefined ? null : headingContentSchema.safeParse(slot);
  if (content && !content.success) return { success: false, error: 'INVALID' };
  return { success: true, data: { categories, content: content?.success ? content.data : null, target: section.target, locale: inputs.locale } };
}
