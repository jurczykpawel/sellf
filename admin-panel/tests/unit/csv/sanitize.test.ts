import { describe, it, expect } from 'vitest';

import { csvField, csvRow, buildCsv } from '@/lib/csv/sanitize';

describe('csvField', () => {
  it('quotes plain ASCII strings', () => {
    expect(csvField('hello')).toBe('"hello"');
  });

  it('doubles internal quotes', () => {
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""');
  });

  it('quotes formula-leading payloads', () => {
    expect(csvField('=cmd()')).toBe('"=cmd()"');
    expect(csvField('+cmd()')).toBe('"+cmd()"');
    expect(csvField('-cmd()')).toBe('"-cmd()"');
    expect(csvField('@cmd()')).toBe('"@cmd()"');
  });

  it('quotes leading-whitespace formula payloads', () => {
    expect(csvField(' =cmd()')).toBe('" =cmd()"');
    expect(csvField('\t=cmd()')).toBe('"\t=cmd()"');
    expect(csvField('\r=cmd()')).toBe('"\r=cmd()"');
  });

  it('handles null and undefined', () => {
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });

  it('stringifies numbers and booleans', () => {
    expect(csvField(42)).toBe('"42"');
    expect(csvField(true)).toBe('"true"');
  });

  it('preserves commas inside quoted cells', () => {
    expect(csvField('a, b, c')).toBe('"a, b, c"');
  });

  it('preserves newlines inside quoted cells', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('csvRow', () => {
  it('joins fields with comma separator', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('"a","b","c"');
  });
});

describe('buildCsv', () => {
  it('assembles headers and rows with newline separators', () => {
    const csv = buildCsv(['id', 'name'], [
      [1, 'Alice'],
      [2, 'Bob, the great'],
    ]);
    expect(csv).toBe('"id","name"\n"1","Alice"\n"2","Bob, the great"');
  });
});
