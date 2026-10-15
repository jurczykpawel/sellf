/** Isolated finder fixture; the catalogue receiver uses only a bounded synthetic page. */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TaskNav from '@/components/storefront/sections/TaskNav';
import { TASK_NAV_FILTER_EVENT } from '@/lib/storefront-templates/task-nav-public';
import type { TaskNavFilter } from '@/lib/storefront-templates/task-nav-public';
import { taskNavFixture } from './task-nav';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const fixture = taskNavFixture(locale, Number(query.get('count') ?? 4), query.has('long'));
function Fixture() {
  const [result, setResult] = useState('');
  useEffect(() => {
    const catalogue = document.getElementById('catalogue')!;
    function filter(event: Event) {
      const { detail } = event as CustomEvent<TaskNavFilter>;
      if (detail.target !== 'catalogue') return;
      event.preventDefault();
      const products = fixture.categories.filter(category => (!detail.categoryIds || detail.categoryIds.includes(category.id)) &&
        (!detail.search || category.label.toLowerCase().includes(detail.search.toLowerCase())));
      setResult(`${products.length} ${locale === 'pl' ? 'wyników na stronie' : 'results on this page'}`);
    }
    if (!query.has('fallback')) catalogue.addEventListener(TASK_NAV_FILTER_EVENT, filter);
    return () => catalogue.removeEventListener(TASK_NAV_FILTER_EVENT, filter);
  }, []);
  return <main><h1>Store fixture</h1><TaskNav {...fixture} />
    <section id="catalogue" aria-label="Catalogue"><h2>Catalogue</h2><p role="status">{result}</p></section>
    <footer><a href="#terms">{locale === 'pl' ? 'Regulamin' : 'Terms'}</a><p id="terms">Store terms</p></footer>
  </main>;
}
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<Fixture />);
