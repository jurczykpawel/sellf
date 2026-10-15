// @vitest-environment happy-dom
/** Catalogue interaction contract. @see spec/contracts/section-contract.md */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import Catalogue from '@/components/storefront/sections/Catalogue';
import {
  resolveCatalogue,
  catalogueGroupsSchema,
  cataloguePageSchema,
} from '@/lib/storefront-templates/catalogue-section';
import { catalogueFixture, catalogueProduct } from '../../fixtures/storefront-sections/catalogue';

vi.mock('@/components/storefront/sections/Catalogue.module.css', () => ({ default: {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const response = (start = 10, nextCursor: string | null = null) => ({
  ok: true,
  json: async () => ({ products: [catalogueProduct(start)], nextCursor }),
});

describe('catalogue', () => {
  it('server renders the initial page without a mount or authentication gate', () => {
    const html = renderToString(React.createElement(Catalogue, catalogueFixture()));
    expect(html).toContain('Product 1');
    expect(html).toContain('Product 9');
    expect(html).toContain('/en/p/product-2');
    expect(html).not.toContain('Loading products');
  });
  it('rejects unsupported page fields and destinations before display', () => {
    const page = catalogueFixture().groups.all!;
    for (const product of [
      { ...catalogueProduct(1), content_config: {} },
      { ...catalogueProduct(1), actions: { details: 'https://example.test', buy: '/en/checkout/product-1' } },
    ]) {
      expect(cataloguePageSchema(9).safeParse({ ...page, products: [product] }).success).toBe(false);
    }
  });
  it('omits unavailable products and leaves missing marketing/media absent', () => {
    const props = catalogueFixture();
    props.groups.all!.products[0].availability = 'unavailable';
    props.groups.all!.products[1].marketing = {
      format: null,
      sourceLocale: 'en',
      en: { result: null, tools: [], requirements: [] },
    };
    const view = render(React.createElement(Catalogue, props));
    expect(view.queryByRole('heading', { name: 'Product 1', exact: true })).toBeNull();
    expect(view.container.querySelectorAll('article')).toHaveLength(8);
    const article = view.getByRole('heading', { name: 'Product 2', exact: true }).closest('article')!;
    expect(article.querySelector('img,dl,details')).toBeNull();
    expect(article.textContent).not.toContain('Build a useful report');
  });
  it('announces an empty initial catalogue without creating product links', () => {
    const view = render(
      React.createElement(Catalogue, { ...catalogueFixture(), groups: { all: { products: [], nextCursor: null } } }),
    );
    expect(view.getByRole('status').textContent).toContain('No products');
    expect(view.queryByRole('link')).toBeNull();
  });
  it('renders bounded public products before interaction with core price/actions and escaped text', () => {
    const props = catalogueFixture();
    props.groups.all!.products[0].title = '<b>Literal title</b>';
    const view = render(React.createElement(Catalogue, props));
    expect(view.container.querySelector('b')).toBeNull();
    expect(view.getByText('<b>Literal title</b>')).toBeTruthy();
    expect(view.getByRole('link', { name: /Product 2/ }).getAttribute('href')).toBe('/en/p/product-2');
    expect(view.getAllByText('0 PLN / month')).toHaveLength(3);
    expect(view.getByRole('status').textContent).toContain('9');
  });
  it.each([9, 12, 24] as const)(
    'appends page size %i, deduplicates and focuses first new result only on More',
    async (pageSize) => {
      const fetcher = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ products: [catalogueProduct(1), catalogueProduct(10)], nextCursor: null }),
      });
      vi.stubGlobal('fetch', fetcher);
      const view = render(React.createElement(Catalogue, { ...catalogueFixture(), pageSize }));
      fireEvent.click(view.getByRole('button', { name: 'More products' }));
      await waitFor(() => expect(view.getByRole('heading', { name: 'Product 10' })).toBeTruthy());
      expect(view.getAllByRole('heading', { name: 'Product 1', exact: true })).toHaveLength(1);
      expect(view.getByRole('heading', { name: 'Product 10' })).toBe(document.activeElement);
      expect(JSON.parse(new URL(fetcher.mock.calls[0][0], 'http://local').searchParams.get('input')!).pageSize).toBe(
        pageSize,
      );
      expect(view.queryByRole('button', { name: 'More products' })).toBeNull();
    },
  );
  it('resets filters and retains focus, announces empty and supports retry without retaining uncertain products', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 422 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [], nextCursor: null }) });
    vi.stubGlobal('fetch', fetcher);
    const view = render(React.createElement(Catalogue, catalogueFixture()));
    const search = view.getByRole('searchbox');
    search.focus();
    fireEvent.change(search, { target: { value: 'nothing' } });
    fireEvent.submit(view.getByRole('search'));
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('changed'));
    expect(document.activeElement).toBe(search);
    expect(view.queryByText('Product 1')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('No products'));
    const input = JSON.parse(new URL(fetcher.mock.calls[0][0], 'http://local').searchParams.get('input')!);
    expect(input).toMatchObject({ search: 'nothing', cursor: null });
  });
  it('keeps independent group cursors and resets all on a filter change', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(40));
    vi.stubGlobal('fetch', fetcher);
    const view = render(React.createElement(Catalogue, catalogueFixture('default-groups')));
    fireEvent.click(view.getByRole('button', { name: 'More free products' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(JSON.parse(new URL(fetcher.mock.calls[0][0], 'http://local').searchParams.get('input')!)).toMatchObject({
      group: 'free',
      cursor: 'free-cursor',
    });
    fireEvent.change(view.getByLabelText('Price'), { target: { value: 'subscription' } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    for (const [url] of fetcher.mock.calls.slice(1))
      expect(JSON.parse(new URL(url, 'http://local').searchParams.get('input')!).cursor).toBeNull();
  });
  it('ignores an older response after a newer filter succeeds', async () => {
    let resolveOld!: (value: ReturnType<typeof response>) => void;
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue(response(50));
    vi.stubGlobal('fetch', fetcher);
    const view = render(React.createElement(Catalogue, catalogueFixture()));
    fireEvent.change(view.getByLabelText('Price'), { target: { value: 'free' } });
    fireEvent.change(view.getByLabelText('Price'), { target: { value: 'subscription' } });
    await waitFor(() => expect(view.getByText('Product 50')).toBeTruthy());
    resolveOld(response(60));
    await waitFor(() => expect(view.queryByText('Product 60')).toBeNull());
  });
  it('keeps page-action focus in the catalogue when a final page has no new rows', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ products: [], nextCursor: null }) }),
    );
    const view = render(React.createElement(Catalogue, catalogueFixture()));
    const more = view.getByRole('button', { name: 'More products' });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(view.queryByRole('button', { name: 'More products' })).toBeNull());
    expect(view.getByRole('status')).toBe(document.activeElement);
  });
  it('validates exact variant group shapes and resolves recipe density without fetching', () => {
    expect(catalogueGroupsSchema('detail-cards', 9).safeParse(catalogueFixture().groups).success).toBe(true);
    expect(catalogueGroupsSchema('default-groups', 9).safeParse(catalogueFixture().groups).success).toBe(false);
    expect(
      catalogueGroupsSchema('detail-cards', 9).safeParse({
        all: { products: Array.from({ length: 10 }, (_, i) => catalogueProduct(i)), nextCursor: null },
      }).success,
    ).toBe(false);
    const spec = {
      id: 'catalogue',
      type: 'catalogue/1',
      variant: 'detail-cards',
      source: 'listed-products',
      filters: [],
      pageSize: 9,
      density: { setting: 'density' },
    };
    expect(resolveCatalogue(spec, { locale: 'en', settings: {}, catalogue: catalogueFixture() })).toMatchObject({
      density: 'comfortable',
      pageSize: 9,
    });
    expect(() =>
      resolveCatalogue({ ...spec, arbitrary: true }, { locale: 'en', settings: {}, catalogue: catalogueFixture() }),
    ).toThrow();
  });
});
