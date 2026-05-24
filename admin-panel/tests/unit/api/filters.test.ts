import { describe, it, expect } from 'vitest';
import { parseCsvFilter, FILTER_MAX_VALUES } from '@/lib/api/filters';

describe('parseCsvFilter', () => {
  it('returns empty for null', () => {
    expect(parseCsvFilter(null)).toEqual({ ids: [], slugs: [] });
  });
  it('classifies UUID into ids', () => {
    expect(parseCsvFilter('d192cab8-fb9c-407b-88e1-69245bb607c3')).toEqual({
      ids: ['d192cab8-fb9c-407b-88e1-69245bb607c3'],
      slugs: [],
    });
  });
  it('classifies slug into slugs', () => {
    expect(parseCsvFilter('starter-pack')).toEqual({ ids: [], slugs: ['starter-pack'] });
  });
  it('mixes UUID and slug from same csv', () => {
    const out = parseCsvFilter('d192cab8-fb9c-407b-88e1-69245bb607c3,courses');
    expect(out.ids).toEqual(['d192cab8-fb9c-407b-88e1-69245bb607c3']);
    expect(out.slugs).toEqual(['courses']);
  });
  it('lowercases UUIDs (canonical form)', () => {
    const out = parseCsvFilter('D192CAB8-FB9C-407B-88E1-69245BB607C3');
    expect(out.ids).toEqual(['d192cab8-fb9c-407b-88e1-69245bb607c3']);
  });
  it('trims whitespace', () => {
    expect(parseCsvFilter(' a , b ')).toEqual({ ids: [], slugs: ['a', 'b'] });
  });
  it('drops empty entries from trailing commas', () => {
    expect(parseCsvFilter('a,,b,')).toEqual({ ids: [], slugs: ['a', 'b'] });
  });
  it('deduplicates within each bucket', () => {
    const out = parseCsvFilter('a,a,b');
    expect(out.slugs).toEqual(['a', 'b']);
  });
  it('returns empty for undefined', () => {
    expect(parseCsvFilter(undefined)).toEqual({ ids: [], slugs: [] });
  });
  it('deduplicates UUIDs (case-insensitive)', () => {
    const out = parseCsvFilter('D192CAB8-FB9C-407B-88E1-69245BB607C3,d192cab8-fb9c-407b-88e1-69245bb607c3');
    expect(out.ids).toEqual(['d192cab8-fb9c-407b-88e1-69245bb607c3']);
  });
  it('throws when slug fails slug regex', () => {
    expect(() => parseCsvFilter('has space')).toThrow(/invalid/i);
  });
  it('throws when total values exceed FILTER_MAX_VALUES', () => {
    const many = Array.from({ length: FILTER_MAX_VALUES + 1 }, (_, i) => `s${i}`).join(',');
    expect(() => parseCsvFilter(many)).toThrow(/too many/i);
  });
});
