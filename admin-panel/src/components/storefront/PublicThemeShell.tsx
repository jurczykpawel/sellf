/** Server-renderable scoped appearance, separate from section props. @see lib/storefront-templates/public-theme.ts */
import { publicThemeCSS } from '@/lib/storefront-templates/public-theme';
import type { ReactNode } from 'react';
import type { PublicThemeSurface } from '@/lib/storefront-templates/public-theme';
import type { PublicThemeTokens } from '@/lib/storefront-templates/schemas';
import styles from './PublicThemeShell.module.css';

export default function PublicThemeShell({ tokens, surface = 'storefront', mode, children }: {
  tokens: PublicThemeTokens; surface?: PublicThemeSurface; mode?: string | null; children: ReactNode;
}) {
  return <div className={`sf-public-theme ${styles.shell}`} data-sf-surface={surface} data-sf-mode={mode === 'light' || mode === 'dark' ? mode : 'system'}>
    <style>{publicThemeCSS(tokens, surface)}</style>
    {children}
  </div>;
}
