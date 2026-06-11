import { describe, it, expect } from 'vitest';
import {
  mapApiInputToProductRow,
  ProductCreateDTO,
  ProductUpdateDTO,
} from '@/lib/api/dto/product';

describe('mapApiInputToProductRow', () => {
  const validBase = {
    name: 'Sample',
    slug: 'sample',
    description: 'd',
    price: 10,
  };

  it('strips fields outside the create allowlist', () => {
    const result = mapApiInputToProductRow(
      {
        ...validBase,
        is_admin: true,
        sale_quantity_sold: 999,
        created_at: '2020-01-01',
        updated_at: '2020-01-01',
        id: 'injected-id',
        oto_enabled: true,
        oto_product_id: 'something',
        arbitrary_field: 'evil',
      },
      'create',
    );

    for (const key of [
      'is_admin',
      'sale_quantity_sold',
      'created_at',
      'updated_at',
      'id',
      'oto_enabled',
      'oto_product_id',
      'arbitrary_field',
    ]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.name).toBe('Sample');
    expect(result.slug).toBe('sample');
  });

  it('lowercases slug and uppercases currency', () => {
    const result = mapApiInputToProductRow(
      { ...validBase, slug: 'AbC', currency: 'usd' },
      'create',
    );
    expect(result.slug).toBe('abc');
    expect(result.currency).toBe('USD');
  });

  it('coerces empty-string date fields to null', () => {
    const result = mapApiInputToProductRow(
      {
        ...validBase,
        available_from: '',
        available_until: '',
        sale_price_until: '',
      },
      'create',
    );
    expect(result.available_from).toBeNull();
    expect(result.available_until).toBeNull();
    expect(result.sale_price_until).toBeNull();
  });

  it('rejects payload missing required fields in create context', () => {
    expect(() =>
      mapApiInputToProductRow({ name: 'X' }, 'create'),
    ).toThrowError();
  });

  it('allows partial payload in update context and strips unknown', () => {
    const result = mapApiInputToProductRow(
      { name: 'Renamed', sale_quantity_sold: 9999 },
      'update',
    );
    expect(result).toEqual({ name: 'Renamed' });
  });

  it('rejects slug with disallowed characters', () => {
    expect(() =>
      mapApiInputToProductRow({ ...validBase, slug: 'Bad Slug!' }, 'create'),
    ).toThrowError();
  });

  it('rejects negative price', () => {
    expect(() =>
      mapApiInputToProductRow({ ...validBase, price: -1 }, 'create'),
    ).toThrowError();
  });

  it('exports DTO schemas', () => {
    expect(ProductCreateDTO).toBeDefined();
    expect(ProductUpdateDTO).toBeDefined();
    expect(typeof ProductCreateDTO.parse).toBe('function');
    expect(typeof ProductUpdateDTO.parse).toBe('function');
  });
});

describe('features sections', () => {
  const validBase = {
    name: 'Sample',
    slug: 'sample',
    description: 'd',
    price: 10,
  };
  const sections = [
    { title: 'In the box', items: ['Workflow JSON', 'PDF guide'] },
    { title: 'Requirements', items: ['n8n instance'] },
  ];

  it('accepts feature sections shaped as { title, items } on create', () => {
    const result = mapApiInputToProductRow({ ...validBase, features: sections }, 'create');
    expect(result.features).toEqual(sections);
  });

  it('accepts feature sections on update', () => {
    const result = mapApiInputToProductRow({ features: sections }, 'update');
    expect(result.features).toEqual(sections);
  });

  it('accepts null and omitted features', () => {
    expect(mapApiInputToProductRow({ ...validBase, features: null }, 'create').features).toBeNull();
    expect(mapApiInputToProductRow({ ...validBase }, 'create').features).toBeUndefined();
  });

  it('rejects plain string features', () => {
    expect(() =>
      mapApiInputToProductRow({ ...validBase, features: ['plain string'] }, 'create'),
    ).toThrowError();
  });

  it('rejects sections without a title or with non-string items', () => {
    expect(() =>
      mapApiInputToProductRow({ ...validBase, features: [{ title: ' ', items: [] }] }, 'create'),
    ).toThrowError();
    expect(() =>
      mapApiInputToProductRow({ ...validBase, features: [{ title: 'Ok', items: [42] }] }, 'create'),
    ).toThrowError();
  });
});
