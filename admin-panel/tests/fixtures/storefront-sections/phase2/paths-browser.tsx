/** Actual starting-path renderer in the isolated section harness. */
import { createRoot } from 'react-dom/client';
import ProductPaths from '@/components/storefront/sections/ProductPaths';
import { resolveProductPaths } from '@/lib/storefront-templates/product-paths';
import { pathsFixture, pathsSpec } from '../product-paths';
import type { PathsState } from '../product-paths';

const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'pl' ? 'pl' : 'en';
const resolved = resolveProductPaths(pathsSpec, pathsFixture(locale, (query.get('state') ?? 'paths') as PathsState));
if (!resolved.success) throw new Error('Invalid paths fixture');
createRoot(document.getElementById('root')!).render(<main>
  <h1 style={{ position: 'absolute', left: '-10000px' }}>Example Studio</h1>
  <ProductPaths {...resolved.data} />
</main>);
