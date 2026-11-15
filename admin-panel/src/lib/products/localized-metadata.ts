/** Customer-facing product text per locale, stored in `content_config.localized.<locale>`. @see lib/actions/product-localization.ts */
import { locales } from '@/lib/locales';

/** Most product IDs one `getProductLocalizations` call accepts; callers split longer lists. */
export const LOCALIZATION_BATCH_SIZE = 200;

export interface LocalizedProductText { name?: string; description?: string; imageAlt?: string }

const LIMITS = { name: 200, description: 2000, image_alt: 500 } as const;

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : undefined;
}

export function localizedFromConfig(config: unknown, locale: string): LocalizedProductText {
  if (!(locales as readonly string[]).includes(locale) || typeof config !== 'object' || config === null) return {};
  const all = (config as { localized?: unknown }).localized;
  if (typeof all !== 'object' || all === null || Array.isArray(all) || !Object.hasOwn(all, locale)) return {};
  const entry = (all as Record<string, unknown>)[locale];
  if (typeof entry !== 'object' || entry === null) return {};
  const source = entry as Record<string, unknown>;
  const name = text(source.name, LIMITS.name), description = text(source.description, LIMITS.description), imageAlt = text(source.image_alt, LIMITS.image_alt);
  return { ...(name ? { name } : {}), ...(description ? { description } : {}), ...(imageAlt ? { imageAlt } : {}) };
}

/** Localized text wins; every missing field keeps the canonical value. */
export function applyLocalized<T extends { name: string; description: string }>(product: T, localized: LocalizedProductText | undefined): T & { imageAlt?: string } {
  if (!localized) return product;
  return { ...product, name: localized.name ?? product.name, description: localized.description ?? product.description, ...(localized.imageAlt ? { imageAlt: localized.imageAlt } : {}) };
}
