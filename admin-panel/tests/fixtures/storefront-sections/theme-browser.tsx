/** Hydrate the production shell and exercise core mode changes. */
import { useEffect } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from '@/components/providers/theme-provider';
import { ThemeFixture } from './theme';
import type { ThemeFixtureProps } from './theme';
const props: ThemeFixtureProps = JSON.parse(document.getElementById('theme-props')!.textContent!);
function HydratedFixture() {
  const { setTheme } = useTheme();
  useEffect(() => {
    document.body.dataset.hydrated = 'true';
    const select = (event: Event) => setTheme((event as CustomEvent<'light' | 'dark'>).detail);
    window.addEventListener('fixture:theme', select);
    return () => window.removeEventListener('fixture:theme', select);
  }, [setTheme]);
  return <ThemeFixture {...props} />;
}
hydrateRoot(document.getElementById('root')!, <ThemeProvider adminTheme={props.mode}><HydratedFixture /></ThemeProvider>);
