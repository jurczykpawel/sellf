/** Actual author renderer in the isolated section harness. */
import { createRoot } from 'react-dom/client';
import AuthorHero from '@/components/storefront/sections/AuthorHero';
import { resolveAuthorHero } from '@/lib/storefront-templates/author-hero';
import { authorHeroFixture, authorHeroRecipe } from '../author-hero';
import type { AuthorHeroState } from '../author-hero';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const inputs = authorHeroFixture(locale, (query.get('state') ?? 'portrait') as AuthorHeroState);
const resolved = resolveAuthorHero(authorHeroRecipe.sections[0], inputs, authorHeroRecipe);
if (!resolved.success) throw new Error('Invalid author fixture');
createRoot(document.getElementById('root')!).render(<main>
  <AuthorHero {...resolved.data} />
  <section id="paths"><h2>{locale === 'pl' ? 'Punkty startu' : 'Starting points'}</h2></section>
  <section id="catalogue"><h2>{locale === 'pl' ? 'Katalog' : 'Catalogue'}</h2></section>
</main>);
