/** Offline authoring contracts. @see spec/contracts/validator-cli.md */
import { effectiveLayout } from '@/lib/storefront-templates/layout';
import { z } from 'zod';
import { phase2ConfigSchema, phase2RecipeSchema, phase2SectionSchema, phase2ContentSchema, phase2SettingsSchema, offerConfigSchema, offerRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import { configSchema, contentSchema, recipeSchema, registryEntrySchema, sectionSchema, tokenOverridesSchema } from '@/lib/storefront-templates/schemas';
import { CONFIG_BYTES, ENVELOPE_BYTES } from '@/lib/storefront-templates/json';
import { CORE_SETTINGS, STOREFRONT_TEMPLATES, isResetPath } from '@/lib/storefront-templates/registry';

export function templateSchemas(): Record<string, z.core.JSONSchema.JSONSchema> {
  return Object.fromEntries(Object.entries({ config: configSchema, recipe: recipeSchema, section: sectionSchema, content: contentSchema, tokens: tokenOverridesSchema, registry: registryEntrySchema, 'phase2-config': phase2ConfigSchema, 'phase2-recipe': phase2RecipeSchema, 'phase2-section': phase2SectionSchema, 'phase2-content': phase2ContentSchema, 'phase2-settings': phase2SettingsSchema, 'offer-config': offerConfigSchema, 'offer-recipe': offerRecipeSchema, offerRecipeSchema }).map(([name, schema]) => [name, z.toJSONSchema(schema)]));
}

export function templateCapabilities() {
  const tokenPaths = Object.entries(tokenOverridesSchema.omit({ format: true }).shape).flatMap(([group, schema]) => Object.keys(schema.unwrap().shape).map(leaf => `tokens.${group}.${leaf}`));
  const resetPaths = Object.fromEntries(Object.values(STOREFRONT_TEMPLATES).map(entry => [entry.id, [
    ...tokenPaths, 'settings.density', 'overrides.order', ...effectiveLayout(entry).sections.flatMap(section => [
      ...(section.descriptor.hideable ? [`overrides.sections.${section.id}.visibility`] : []),
      ...(section.descriptor.variants.length ? [`overrides.sections.${section.id}.variant`] : []),
    ]),
  ].filter(path => isResetPath(entry.id, path))]));
  const slots = Object.fromEntries(Object.entries(contentSchema.shape).map(([id, schema]) => [id, schema.unwrap().options[0].shape.en.shape.kind.value]));
  return {
    validatorVersion: 1, offline: true, templates: Object.values(STOREFRONT_TEMPLATES), coreSettings: CORE_SETTINGS,
    phase2: { selectable: false, installedTemplateIds: ['storefront-a', 'storefront-b', 'storefront-c'], slots: Object.fromEntries(Object.entries(phase2ContentSchema.shape).map(([id, schema]) => [id, schema.unwrap().options[0].shape.en.shape.kind.value])), limits: { comparison: 2, featured: 6, paths: 4, projects: 3, categoryDescriptions: 12 } },
    offers: { templateIds: ['offer-default'], productBinding: 'route-product', resetPaths: ['appearance', 'density'],
      slots: Object.fromEntries(Object.entries(offerConfigSchema.shape.content.shape).map(([id, schema]) => [id, schema.unwrap().options[0].shape.en.shape.kind.value])) },
    slots, resetPaths, orderPolicy: { read: 'unique-known-subset', write: 'full-resolved-list', omittedSection: 'inherit-default-visibility' }, schemas: templateSchemas(),
    limits: { configInputBytes: CONFIG_BYTES, configStoredBytes: CONFIG_BYTES, requestBytes: ENVELOPE_BYTES, depth: 12, revision: Number.MAX_SAFE_INTEGER },
  };
}
