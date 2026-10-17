/** Production shell and composition for appearance/browser checks. */
import PublicThemeShell from '@/components/storefront/PublicThemeShell';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import { resolvePublicTheme } from '@/lib/storefront-templates/public-theme';
import { D_TOKENS } from '@/lib/storefront-templates/fixtures';
import { compositionFixture } from './composition';
export interface ThemeFixtureProps {
  locale: 'en' | 'pl'; font: 'geist' | 'dm-sans'; surface: 'storefront' | 'protected'; mode: 'light' | 'dark' | 'system'; template?: 'default' | 'd';
}
export function ThemeFixture({ locale, font, surface, mode, template = 'd' }: ThemeFixtureProps) {
  const model = compositionFixture(locale, template);
  const hero = model.sections.find(s => s.type === 'hero-product/1');
  if (hero?.type === 'hero-product/1' && hero.props.product) hero.props.product.image = { src: '/example.svg', width: 800, height: 500, alt: 'Example diagram' };
  const theme = resolvePublicTheme(template === 'd' ? D_TOKENS : null, { format: 1, typography: { font, bodyWeight: 500, headingWeight: 700, baseSizePx: 18, headingLetterSpacingEm: 0 }, shapes: { radiusSmPx: 8, radiusMdPx: 4, radiusLgPx: 24 } }, true, surface);
  return (<PublicThemeShell tokens={theme.tokens} surface={surface} mode={mode}>
    {surface === 'storefront' ? <StorefrontComposition model={model} shopName="Example" renderKey="theme" year={2026} showSellfBranding={false} /> : <main><h1>Purchase / Zakup</h1><label htmlFor="email">Email</label><input id="email" type="email" /><button>Continue / Dalej</button><p role="alert">Check your email / Sprawdź email</p><a href={locale === 'pl' ? '/pl/terms' : '/terms'}>Terms / Regulamin</a></main>}
    <p id="glyphs">Zażółć gęślą jaźń ĄĆĘŁŃÓŚŹŻ</p>
  </PublicThemeShell>);
}
