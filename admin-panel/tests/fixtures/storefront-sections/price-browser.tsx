/** Hydrate server-rendered prices using Chromium's Intl implementation. */
import { createElement, useEffect } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { PriceFixture } from './price-render';

function HydratedPrices() {
  useEffect(() => { document.documentElement.dataset.hydrated = 'true'; }, []);
  return createElement(PriceFixture);
}

hydrateRoot(document.getElementById('root')!, createElement(HydratedPrices), {
  onRecoverableError(error) { throw error; },
});

const client = document.createElement('div');
client.id = 'client';
document.body.append(client);
createRoot(client).render(createElement(PriceFixture));
