/** Server output from the shared production-shell fixture. */
import { renderToString } from 'react-dom/server';
import { ThemeScript } from '@/components/providers/theme-provider';
import { ThemeFixture } from './theme';
const pages: Record<string, string> = {};
const scripts: Record<string, string> = {};
for (const mode of ['light', 'dark', 'system'] as const) {
  scripts[mode] = renderToString(<ThemeScript adminTheme={mode} />);
  for (const locale of ['en', 'pl'] as const) for (const font of ['geist', 'dm-sans'] as const) for (const surface of ['storefront', 'protected'] as const) {
    pages[`${locale}/${font}/${surface}/${mode}`] = renderToString(<ThemeFixture locale={locale} font={font} surface={surface} mode={mode} />);
    pages[`${locale}/${font}/${surface}/${mode}/default`] = renderToString(<ThemeFixture locale={locale} font={font} surface={surface} mode={mode} template="default" />);
  }
}
process.stdout.write(JSON.stringify({ pages, scripts }));
