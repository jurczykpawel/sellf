/** Installed C dispatch uses localized public inputs. */
import { describe, expect, it } from 'vitest';
import { resolvePresentation } from '@/lib/storefront-templates/resolver';
import { PUBLIC_FIXTURE } from '@/lib/storefront-templates/fixtures';
import type { StorefrontSelection } from '@/lib/storefront-templates/resolver';
import type { PublicProductInfo } from '@/lib/storefront-templates/catalogue';
import { phase2Config, phase2Recipes, uuid } from '../../fixtures/storefront-sections/phase2/contracts';

const selection = { templateId: 'storefront-c', recipe: phase2Recipes.c, settings: {}, content: phase2Config.content, diagnostic: null } as unknown as StorefrontSelection;
const product = { ...PUBLIC_FIXTURE.products[0], id: uuid(1), availability: 'available' } as PublicProductInfo;
const inputs = { locale: 'pl' as const, productsById: { [product.id]: product }, categoriesById: {},
  catalogue: { variant: 'compact' as const, groups: { all: { products: [], nextCursor: null } }, filters: [], pageSize: 24 as const, density: 'comfortable' as const, locale: 'pl' as const } };

describe('C runtime composition', () => {
  it('dispatches the four author families in frozen order with source-locale copy', () => {
    const model = resolvePresentation(selection, inputs);
    expect(model.sections.map(section => section.type)).toEqual(['author-hero/1', 'author-story/1', 'product-paths/1', 'project-showcase/1', 'product-list/1', 'catalogue/1', 'faq/1', 'product-cta/1']);
    expect(model.sections[0]).toMatchObject({ props: { content: phase2Config.content['home.author'].en, portrait: null } });
    expect(model.sections[1]).toMatchObject({ props: { content: phase2Config.content['home.story'].en } });
    expect(model.sections[2]).toMatchObject({ props: { items: [{ product }] } });
    expect(model.sections[3]).toMatchObject({ props: { items: [{ name: 'Example Notebook', media: null }] } });
  });
  it('omits absent public path products and projects only caller-approved media DTOs', () => {
    const media = { src: 'https://example.test/portrait.png', alt: 'Alex', width: 440, height: 484 };
    const custom = structuredClone(selection);
    Object.assign(custom.content['home.author']!.en!, { portraitMediaId: uuid(20) });
    const model = resolvePresentation(custom, { ...inputs, productsById: {}, pathProductsById: { [uuid(1)]: null }, mediaById: { [uuid(20)]: media } });
    expect(model.sections[0]).toMatchObject({ props: { portrait: media } });
    expect(model.sections.find(section => section.type === 'product-paths/1')).toMatchObject({ props: { items: [] } });
  });
});

it('resolves accepted uppercase UUID references against canonical public adapter keys', () => {
  const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const selected = structuredClone(selection);
  const paths = phase2Config.content['home.paths'].en;
  selected.content['home.paths'] = { sourceLocale: 'en', en: { ...paths, items: [{ ...paths.items[0], productId: id.toUpperCase() }] } };
  Object.assign(selected.content['home.author']!.en!, { portraitMediaId: id.toUpperCase() });
  const projects = phase2Config.content['home.projects'].en;
  selected.content['home.projects'] = { sourceLocale: 'en', en: { ...projects, items: [{ ...projects.items[0], mediaId: id.toUpperCase() }] } };
  const image = { src: 'https://example.test/cover.png', alt: 'Example', width: 800, height: 500 };
  const canonical = { ...product, id, image };
  const model = resolvePresentation(selected, { ...inputs, pathProductsById: { [id]: canonical }, mediaById: { [id]: image } });
  expect(model.sections[0]).toMatchObject({ props: { portrait: image } });
  expect(model.sections.find(section => section.type === 'product-paths/1')).toMatchObject({ props: { items: [{ product: canonical }] } });
  expect(model.sections.find(section => section.type === 'project-showcase/1')).toMatchObject({ props: { items: [{ media: image }] } });
});
