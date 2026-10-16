/** Hydrate the same public model used for first paint. */
import { hydrateRoot } from 'react-dom/client';
import StorefrontComposition from '@/components/storefront/StorefrontComposition';
import type { PresentationModel } from '@/lib/storefront-templates/resolver';
const model: PresentationModel = JSON.parse(document.getElementById('model')!.textContent!);
const root = hydrateRoot(document.getElementById('root')!, <StorefrontComposition renderKey="initial" model={model} shopName="Example shop" />);
window.addEventListener('composition:replace', event => {
  const next: PresentationModel = (event as CustomEvent<PresentationModel>).detail;
  root.render(<StorefrontComposition renderKey="replacement" model={next} shopName="Example shop" />);
});
