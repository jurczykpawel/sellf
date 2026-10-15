/** Synthetic existing categories, shared by unit and browser task-navigation checks. */
import type { TaskNavProps } from '@/lib/storefront-templates/task-nav-public';

export function taskNavFixture(locale: 'en' | 'pl', count = 4, long = false): TaskNavProps {
  const labels = locale === 'pl' ? ['Faktury', 'Marketing', 'Sklep', 'Narzędzia'] : ['Invoices', 'Marketing', 'Shop', 'Tools'];
  return { locale, target: 'catalogue', content: { kind: 'heading',
    heading: locale === 'pl' ? 'Co chcesz zbudować?' : 'What do you want to build?',
    body: locale === 'pl' ? 'Przeglądaj istniejące kategorie produktów.' : 'Browse the existing product categories.' },
    categories: Array.from({ length: count }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
      label: long ? 'Żółć '.repeat(20).trim() : labels[i % labels.length], filterTarget: 'catalogue' })),
  };
}
