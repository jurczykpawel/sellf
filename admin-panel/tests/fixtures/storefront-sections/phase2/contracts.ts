/** Synthetic authoring inputs, independent of registry activation. @see docs/templates/phase2-contracts.md */
import { D_CONFIG } from '@/lib/storefront-templates/fixtures';
import { STOREFRONT_TEMPLATES } from '@/lib/storefront-templates/registry';
import { referenceCopy, referenceProducts } from './reference';

export const uuid = (i: number): string => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const catalogue = { ...STOREFRONT_TEMPLATES.d.defaults.sections[3], variant: 'compact' };
const faq = { id: 'faq', type: 'faq/1', content: { slot: 'home.faq' } };
const closing = { id: 'closing', type: 'product-cta/1', variant: 'catalogue-link', content: { slot: 'home.closing' }, target: 'catalogue' };
const starts = { id: 'start', type: 'product-list/1', variant: 'detail-cards', products: { setting: 'starterProducts' }, content: { slot: 'home.starts' } };
const recipe = (sections: unknown[]) => ({ format: 1, surface: 'storefront', shell: 'store/1', sections });
export const phase2Recipes = {
  a: recipe([
    { id: 'hero', type: 'hero-product/1', variant: 'offer-focus', product: { setting: 'heroProduct' }, content: { slot: 'home.hero' } },
    { ...STOREFRONT_TEMPLATES.d.defaults.sections[1] },
    { id: 'comparison', type: 'product-list/1', variant: 'comparison', products: { setting: 'comparisonProducts' }, content: { slot: 'home.comparison' } },
    starts, catalogue, faq, closing,
  ]),
  b: recipe([
    { id: 'hero', type: 'task-nav/1', variant: 'search-hero', categories: { setting: 'taskCategories' }, content: { slot: 'home.search' }, target: 'catalogue' },
    { id: 'featured', type: 'product-list/1', variant: 'featured-grid', products: { setting: 'featuredProducts' }, content: { slot: 'home.featured' } },
    catalogue, { id: 'starter', type: 'product-cta/1', product: { setting: 'closingProduct' }, content: { slot: 'home.starter' }, action: 'details' }, faq, closing,
  ]),
  c: recipe([
    { id: 'hero', type: 'author-hero/1', content: { slot: 'home.author' }, pathsTarget: 'paths', catalogueTarget: 'catalogue' },
    { id: 'story', type: 'author-story/1', content: { slot: 'home.story' } },
    { id: 'paths', type: 'product-paths/1', content: { slot: 'home.paths' } },
    { id: 'projects', type: 'project-showcase/1', content: { slot: 'home.projects' } }, starts, catalogue, faq, closing,
  ]),
  offer: { format: 1, surface: 'offer', shell: 'offer/1', sections: [
    { id: 'hero', type: 'hero-product/1', variant: 'simple', product: { source: 'route-product' }, content: { slot: 'offer.hero' } },
    { id: 'faq', type: 'faq/1', content: { slot: 'offer.faq' } },
    { id: 'closing', type: 'product-cta/1', product: { source: 'route-product' }, content: { slot: 'offer.closing' }, action: 'buy' },
  ] },
};
export const phase2Config = {
  ...D_CONFIG, templateId: 'storefront-a',
  overridesByTemplate: { ...D_CONFIG.overridesByTemplate, 'storefront-a': { order: phase2Recipes.a.sections.map(section => section.id), sections: { tasks: { visibility: 'visible' }, start: { variant: 'detail-cards' } } } },
  settingsByTemplate: { ...D_CONFIG.settingsByTemplate, 'storefront-a': { heroProduct: uuid(1), comparisonProducts: [uuid(1), uuid(2)], starterProducts: [uuid(3)], density: 'comfortable' }, 'storefront-b': { featuredProducts: Array.from({ length: 6 }, (_, i) => uuid(i + 1)), closingProduct: uuid(2) } },
  content: {
    ...D_CONFIG.content,
    'home.search': { sourceLocale: 'en', en: { kind: 'search', heading: 'Find your next task', body: 'Choose a task or search the catalogue.', items: [{ id: 'research', categoryId: uuid(1), description: 'Explore a new idea.' }] } },
    'home.comparison': { sourceLocale: 'en', en: { kind: 'comparison', heading: 'Two tasks, two products', body: 'Separate stages of work.', items: [1, 2].map(i => ({ productId: uuid(i), eyebrow: 'A place to start', heading: `Task ${i}`, body: 'A synthetic example.', bullets: ['Read the guide'] })) } },
    'home.author': { sourceLocale: 'en', en: { kind: 'author', name: 'Alex Example', eyebrow: 'Independent maker', heading: 'Build one useful thing', intro: 'Synthetic author story for layout review.', portraitMediaId: null } },
    'home.story': { sourceLocale: 'en', en: { kind: 'biography', heading: 'Start with the task', paragraphs: ['I make small tools for my own projects.'] } },
    'home.paths': { sourceLocale: 'en', en: { kind: 'paths', heading: 'Choose a starting point', body: 'One task at a time.', items: [{ id: 'research', productId: uuid(1), situation: 'Explore an idea', body: 'A small guide to begin.' }] } },
    'home.projects': { sourceLocale: 'en', en: { kind: 'projects', heading: 'Example projects', items: [{ id: 'notebook', name: 'Example Notebook', body: 'A synthetic project.', url: 'https://example.test/notebook', mediaId: null }] } },
  },
};

/** Complete matching visual author inputs; section recipes above define A/B/C order. */
export function referenceConfig() {
  const localized = <T>(build: (locale: 'en' | 'pl') => T) => ({ sourceLocale: 'en' as const, en: build('en'), pl: build('pl') });
  const heading = (value: string) => value.replaceAll('<br>', '\n').replaceAll(/<\/?em>/g, '');
  return { ...phase2Config,
    settingsByTemplate: { ...phase2Config.settingsByTemplate,
      'storefront-a': { heroProduct: uuid(2), comparisonProducts: [uuid(1), uuid(2)], starterProducts: [uuid(1), uuid(2), uuid(3)], taskCategories: [uuid(1), uuid(2), uuid(3), uuid(4)], density: 'comfortable' },
      'storefront-b': { featuredProducts: referenceProducts('en').map(product => product.id), closingProduct: uuid(1), taskCategories: [uuid(1), uuid(2), uuid(3), uuid(4)] },
      'storefront-c': { starterProducts: [uuid(2), uuid(3), uuid(4)] },
    },
    content: { ...phase2Config.content,
      'home.hero': localized(locale => ({ kind: 'hero' as const, eyebrow: referenceCopy[locale].eyebrow, heading: heading(referenceCopy[locale].offer), body: referenceCopy[locale].intro, steps: referenceCopy[locale].tasks.slice(0, 3), mediaCaption: 'PL / EN', stepDetails: referenceCopy[locale].tasks.slice(0, 3).map(() => referenceCopy[locale].receive), staticDemo: { title: referenceCopy[locale].demo, body: referenceCopy[locale].projectBody } })),
      'home.starts': localized(locale => ({ kind: 'heading' as const, heading: referenceCopy[locale].start, body: referenceCopy[locale].requirement })),
      'home.featured': localized(locale => ({ kind: 'heading' as const, heading: referenceCopy[locale].featured, body: referenceCopy[locale].requirement })),
      'home.search': localized(locale => ({ kind: 'search' as const, eyebrow: referenceCopy[locale].eyebrow, heading: heading(referenceCopy[locale].finder), body: heading(referenceCopy[locale].finderBody), items: referenceCopy[locale].tasks.map((_, i) => ({ id: `task-${i}`, categoryId: uuid(i + 1), description: referenceCopy[locale].taskBody })) })),
      'home.comparison': localized(locale => ({ kind: 'comparison' as const, heading: referenceCopy[locale].comparison, body: referenceCopy[locale].distinct, items: [0, 1].map(i => ({ productId: uuid(i + 1), eyebrow: i === 0 ? referenceCopy[locale].free : referenceCopy[locale].product, heading: referenceCopy[locale].tasks[i], body: referenceCopy[locale].result, bullets: referenceCopy[locale].tasks.slice(0, 3) })) })),
      'home.author': localized(locale => ({ kind: 'author' as const, name: 'Alex Example', eyebrow: referenceCopy[locale].author, heading: heading(referenceCopy[locale].authorTitle), intro: referenceCopy[locale].authorIntro, portraitMediaId: uuid(20) })),
      'home.story': localized(locale => ({ kind: 'biography' as const, heading: heading(referenceCopy[locale].story), paragraphs: [referenceCopy[locale].quote, referenceCopy[locale].authorIntro] })),
      'home.paths': localized(locale => ({ kind: 'paths' as const, heading: referenceCopy[locale].pathsTitle, body: referenceCopy[locale].requirement, items: referenceCopy[locale].tasks.map((task, i) => ({ id: `path-${i}`, productId: uuid(i + 1), situation: task, body: referenceCopy[locale].result })) })),
      'home.projects': localized(locale => ({ kind: 'projects' as const, heading: referenceCopy[locale].projects, items: [1, 2, 3].map(i => ({ id: `project-${i}`, name: `Example ${i}`, body: referenceCopy[locale].projectBody, url: `https://example.test/project-${i}`, mediaId: null })) })),
      'home.starter': localized(locale => ({ kind: 'cta' as const, heading: referenceCopy[locale].starter, body: referenceCopy[locale].result })),
      'home.closing': localized(locale => ({ kind: 'cta' as const, heading: referenceCopy[locale].closing, body: '' })),
      'home.faq': localized(locale => ({ kind: 'faq' as const, items: [0, 1, 2].map(i => ({ id: `question-${i}`, question: referenceCopy[locale].question, answer: referenceCopy[locale].answer })) })),
    },
  };
}
