/** Single interpretation of stored layout intent; no writes during resolution. @see section-descriptors.ts */
import type { LayoutOverrides, SectionDescriptor, SectionVisibility } from '@/lib/storefront-templates/section-descriptors';
import type { SectionSpec, TemplateRecipe } from '@/lib/storefront-templates/schemas';

interface LayoutDefinition { id?: string; defaults: TemplateRecipe; sectionDescriptors: Readonly<Record<string, SectionDescriptor>> }
export interface EffectiveSection {
  id: string; visibility: SectionVisibility; variant?: string;
  visibilityOrigin: 'seller' | 'template'; variantOrigin: 'seller' | 'template';
  descriptor: SectionDescriptor; spec: SectionSpec;
}
export interface EffectiveLayout { order: string[]; sections: EffectiveSection[]; recipe: TemplateRecipe; valid: boolean }

export function effectiveLayout(entry: LayoutDefinition, overrides?: LayoutOverrides): EffectiveLayout {
  const defaults = entry.defaults.sections;
  const descriptors = entry.sectionDescriptors;
  const known = new Set(defaults.map(section => section.id));
  const order = [...overrides?.order ?? []];
  let valid = defaults.length <= 32 && known.size === defaults.length && order.length <= 32 && new Set(order).size === order.length && order.every(id => known.has(id));
  valid &&= Object.keys(descriptors).length === known.size && [...known].every(id => Object.hasOwn(descriptors, id));
  const pending = defaults.filter(section => !order.includes(section.id)).map(section => section.id);
  const afterTail = new Map<string, string>();
  while (pending.length && valid) {
    let progress = false;
    for (const id of [...pending]) {
      const placement = descriptors[id].placement;
      let index: number;
      if ('pin' in placement) index = placement.pin === 'first' ? 0 : order.length;
      else {
        const anchor = 'after' in placement ? afterTail.get(placement.after) ?? placement.after : placement.before;
        const at = order.indexOf(anchor);
        if (at < 0) continue;
        index = at + ('after' in placement ? 1 : 0);
        if ('after' in placement) afterTail.set(placement.after, id);
      }
      order.splice(index, 0, id); pending.splice(pending.indexOf(id), 1); progress = true;
    }
    if (!progress) valid = false;
  }
  const sections = order.flatMap((id): EffectiveSection[] => {
    const source = defaults.find(section => section.id === id); const descriptor = descriptors[id];
    if (!source || !descriptor) return [];
    const intent = overrides?.sections?.[id];
    const visibility = intent?.visibility ?? descriptor.defaultVisibility;
    const variant = intent?.variant ?? ('variant' in source ? source.variant : undefined);
    if ((!descriptor.hideable && visibility !== 'visible') || (variant !== undefined && !descriptor.variants.includes(variant))) valid = false;
    const spec = structuredClone(source);
    if (variant !== undefined && 'variant' in spec) Object.assign(spec, { variant });
    return [{ id, descriptor, visibility, variant, visibilityOrigin: intent?.visibility === undefined ? 'template' : 'seller', variantOrigin: intent?.variant === undefined ? 'template' : 'seller', spec }];
  });
  const recipe = { ...entry.defaults, sections: sections.filter(section => section.visibility === 'visible').map(section => section.spec) };
  valid &&= recipe.sections.some(section => section.type === 'catalogue/1');
  valid &&= (entry.id !== 'd' && entry.id !== 'storefront-a') || recipe.sections[0]?.type === 'hero-product/1';
  valid &&= recipe.sections.every(section => (section.type !== 'task-nav/1' && !(section.type === 'product-cta/1' && 'target' in section)) || recipe.sections.some(target => target.id === section.target && target.type === 'catalogue/1'));
  return { order, sections, valid, recipe };
}
