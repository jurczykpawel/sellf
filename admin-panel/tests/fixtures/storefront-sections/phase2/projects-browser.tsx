/** Actual project renderer in the isolated section harness. */
import { createRoot } from 'react-dom/client';
import ProjectShowcase from '@/components/storefront/sections/ProjectShowcase';
import { resolveProjectShowcase } from '@/lib/storefront-templates/project-showcase';
import { projectsFixture, projectsSpec } from '../project-showcase';
import type { ProjectsState } from '../project-showcase';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const resolved = resolveProjectShowcase(projectsSpec, projectsFixture(locale, (query.get('state') ?? 'projects') as ProjectsState));
if (!resolved.success) throw new Error('Invalid projects fixture');
createRoot(document.getElementById('root')!).render(<main>
  <h1 style={{ position: 'absolute', left: '-10000px' }}>Example Studio</h1>
  <ProjectShowcase {...resolved.data} />
</main>);
