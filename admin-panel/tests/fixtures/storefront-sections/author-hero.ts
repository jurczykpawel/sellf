/** Author-only public batches; no product or request dependency. @see docs/templates/phase2-contracts.md */
import { phase2StorefrontRecipeSchema } from '@/lib/storefront-templates/phase2-contracts';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import { phase2Recipes, referenceConfig, uuid } from './phase2/contracts';

export const authorHeroRecipe = phase2StorefrontRecipeSchema.parse(phase2Recipes.c);
export type AuthorHeroState = 'portrait' | 'no-eyebrow' | 'empty' | 'blank' | 'no-media' | 'unresolved-media' | 'long' | 'hostile';
export function authorHeroFixture(locale: 'en' | 'pl', state: AuthorHeroState = 'portrait') {
  const content = { ...referenceConfig().content['home.author'][locale] };
  if (state === 'no-eyebrow') content.eyebrow = '';
  if (state === 'long') Object.assign(content, { name: 'ąŻName'.repeat(20), eyebrow: 'ąŻLong'.repeat(13), heading: 'ąŻLongExample'.repeat(14).slice(0, 160), intro: 'Long illustrative text ąŻ '.repeat(180).slice(0, 4000) });
  if (state === 'hostile') Object.assign(content, { name: '" & { author }', heading: '" & { heading }', intro: 'https://example.test/?a=1&b=2 "quoted" text' });
  if (state === 'no-media' || state === 'blank') content.portraitMediaId = null;
  if (state === 'blank') Object.assign(content, { name: '', eyebrow: '', heading: '', intro: '' });
  const mediaById: Record<string, NonNullable<PublicProductInfo['image']>> = state === 'unresolved-media' ? {} : {
    [uuid(20)]: { src: 'https://phase2.test/sample.svg', alt: content.name, width: 440, height: 484 },
  };
  return { locale, slots: state === 'empty' ? {} as Record<string, typeof content> : { 'home.author': content }, mediaById };
}
