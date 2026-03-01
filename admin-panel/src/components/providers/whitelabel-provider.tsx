'use client';

/**
 * WhitelabelProvider — injects theme CSS custom properties (--sf-* + --color-sf-*).
 * Receives pre-validated theme data from server components.
 * Only applies overrides when license is valid AND a theme is configured.
 * @see lib/themes/index.ts for themeToCSS mapping
 * @see lib/actions/theme.ts for server-side theme loading
 */

import { useEffect } from 'react';
import { themeToCSS } from '@/lib/themes';
import type { ThemeConfig } from '@/lib/themes';

interface WhitelabelProviderProps {
  theme: ThemeConfig | null;
  licenseValid: boolean;
  children: React.ReactNode;
}

export default function WhitelabelProvider({ theme, licenseValid, children }: WhitelabelProviderProps) {
  useEffect(() => {
    if (!theme || !licenseValid) return;

    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    const vars = themeToCSS(theme, isDark);

    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }

    // Listen for theme toggle (dark/light switch)
    const handleThemeChange = () => {
      const nowDark = root.classList.contains('dark');
      const newVars = themeToCSS(theme, nowDark);
      for (const [key, value] of Object.entries(newVars)) {
        root.style.setProperty(key, value);
      }
    };

    window.addEventListener('sf-theme-change', handleThemeChange);

    // Also observe class changes on <html> for theme toggle
    const observer = new MutationObserver(() => handleThemeChange());
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => {
      window.removeEventListener('sf-theme-change', handleThemeChange);
      observer.disconnect();

      // Clean up injected variables
      for (const key of Object.keys(vars)) {
        root.style.removeProperty(key);
      }
    };
  }, [theme, licenseValid]);

  return <>{children}</>;
}
