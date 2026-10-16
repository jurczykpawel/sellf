/** Synthetic composition fixtures. @see spec/contracts/template-recipe.md */
import type { PublicThemeTokens, StorefrontConfig } from '@/lib/storefront-templates/schemas';

export const D_TOKENS: PublicThemeTokens = {"format":1,"light":{"background":"#FAF8F4","foreground":"#181818","accent":"#075C43","accentForeground":"#FFFFFF","muted":"#F0EEE9","mutedForeground":"#545454","border":"#767676"},"dark":{"background":"#151916","foreground":"#F6F7F5","accent":"#89D8B5","accentForeground":"#10251B","muted":"#202923","mutedForeground":"#BAC7BE","border":"#789082"},"typography":{"font":"geist","bodyWeight":400,"headingWeight":600,"baseSizePx":16,"headingLetterSpacingEm":-0.01},"shapes":{"radiusSmPx":4,"radiusMdPx":12,"radiusLgPx":16}};
/** Offer-led palette; core font and action semantics remain shared. */
export const A_TOKENS: PublicThemeTokens = { ...D_TOKENS,
  light: { ...D_TOKENS.light, background: '#F5F5F0', foreground: '#17191F', accent: '#244B9A', muted: '#E8EEFB', mutedForeground: '#555D69' },
  dark: { ...D_TOKENS.dark, background: '#151923', foreground: '#F5F6FA', accent: '#ABC6FF', accentForeground: '#142341', muted: '#222D43', mutedForeground: '#BEC9DF', border: '#8192B1' },
};
export const DEFAULT_CONFIG: StorefrontConfig = { format: 1, templateId: 'default', settingsByTemplate: {}, overridesByTemplate: {}, content: {}, tokens: null };
export const D_CONFIG: StorefrontConfig = {
  "format": 1,
  "templateId": "d",
  "settingsByTemplate": {
    "d": {
      "heroProduct": "11111111-1111-4111-8111-111111111111",
      "closingProduct": "11111111-1111-4111-8111-111111111111",
      "starterProducts": ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"],
      "taskCategories": ["55555555-5555-4555-8555-555555555555"],
      "density": "comfortable"
    },
    "default": {}
  },
  "overridesByTemplate": {
    "d": {"order": ["hero", "tasks", "start", "catalogue", "faq", "closing"], "sections": {"hero": {"variant": "split-process"}}},
    "default": {}
  },
  "content": {
    "home.hero": {"sourceLocale": "en", "en": {"kind": "hero", "eyebrow": "Example workshop", "heading": "Build your first automated report", "body": "Learn the workflow using a synthetic dataset.", "steps": ["Choose the input", "Build the workflow", "Review the report"]}},
    "home.tasks": {"sourceLocale": "en", "en": {"kind": "heading", "heading": "What do you want to build?", "body": "Browse the existing product categories."}},
    "home.starts": {"sourceLocale": "en", "en": {"kind": "heading", "heading": "Three starting points", "body": "Choose a product matching your current skills."}},
    "home.faq": {"sourceLocale": "en", "en": {"kind": "faq", "items": [{"id": "requirements", "question": "Where are the requirements?", "answer": "Each product lists its requirements alongside its offer."}]}},
    "home.closing": {"sourceLocale": "en", "en": {"kind": "cta", "heading": "Read the workshop details", "body": "Review the current product offer before buying."}}
  },
  "tokens": null
};

export const PUBLIC_FIXTURE = {
  products: ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'].map((id, index) => ({
    id, slug: `example-${index + 1}`, title: `Example ${index + 1}`,
    price: { display: index === 1 ? 'Free' : '$10', taxNote: null, omnibus: null, kind: index === 1 ? 'free' : index === 2 ? 'subscription' : 'one-time' },
    marketing: { format: 'workshop', sourceLocale: 'en', en: { result: null, tools: [], requirements: [] } },
    image: null, actions: { details: `/en/p/example-${index + 1}`, buy: `/en/checkout/example-${index + 1}` }, availability: 'available',
  })),
  categories: [{ id: '55555555-5555-4555-8555-555555555555', label: 'Example category', filterTarget: 'catalogue' }],
};

/** Bilingual seller-copy fixture; the English-only fixture retains fallback coverage. */
export const D_LOCALIZED_CONFIG: StorefrontConfig = {
  ...D_CONFIG,
  content: {
    'home.hero': { ...D_CONFIG.content['home.hero']!, pl: { kind: 'hero', eyebrow: 'Przykładowy warsztat', heading: 'Zbuduj swój pierwszy automatyczny raport', body: 'Poznaj ten proces na przykładowych danych.', steps: ['Wybierz dane wejściowe', 'Zbuduj proces', 'Sprawdź raport'] } },
    'home.tasks': { ...D_CONFIG.content['home.tasks']!, pl: { kind: 'heading', heading: 'Co chcesz zbudować?', body: 'Przeglądaj dostępne kategorie produktów.' } },
    'home.starts': { ...D_CONFIG.content['home.starts']!, pl: { kind: 'heading', heading: 'Trzy punkty startowe', body: 'Wybierz produkt dopasowany do swoich umiejętności.' } },
    'home.faq': { ...D_CONFIG.content['home.faq']!, pl: { kind: 'faq', items: [{ id: 'requirements', question: 'Gdzie znajdę wymagania?', answer: 'Wymagania znajdziesz przy ofercie każdego produktu.' }] } },
    'home.closing': { ...D_CONFIG.content['home.closing']!, pl: { kind: 'cta', heading: 'Poznaj szczegóły warsztatu', body: 'Przed zakupem zapoznaj się z aktualną ofertą produktu.' } },
  },
};
