/** Actual biography renderer in the isolated section harness. */
import { createRoot } from 'react-dom/client';
import AuthorStory from '@/components/storefront/sections/AuthorStory';
import { resolveAuthorStory } from '@/lib/storefront-templates/author-story';
import { authorStoryFixture, storySpec } from '../author-story';
import type { AuthorStoryState } from '../author-story';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const resolved = resolveAuthorStory(storySpec, authorStoryFixture(locale, (query.get('state') ?? 'story') as AuthorStoryState));
if (!resolved.success) throw new Error('Invalid biography fixture');
createRoot(document.getElementById('root')!).render(<main>
  <h1 style={{ position: 'absolute', left: '-10000px' }}>Example Studio</h1>
  <AuthorStory {...resolved.data} />
  <a href="#after" style={{ color: 'var(--sf-text-heading)' }}>After story</a>
  <div id="after" />
</main>);
