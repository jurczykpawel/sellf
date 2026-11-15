import { describe, it, expect } from 'vitest';

import {
  buildSnapshot,
  normalizeDump,
  rewriteConfigForSnapshot,
  snapshotDiff,
} from '@/../scripts/schema-snapshot';

describe('normalizeDump', () => {
  const header = [
    '--',
    '-- PostgreSQL database dump',
    '--',
    '',
    '\\restrict AbCdEf123',
    '',
    '-- Dumped from database version 15.8',
    '-- Dumped by pg_dump version 15.8',
    '',
  ];

  it('drops the version banner and the restrict keys, keeps every other byte', () => {
    const body = ['CREATE TABLE public.products (id uuid);   ', '', '', '', 'ALTER TABLE public.products OWNER TO postgres;', ''];
    const dump = [...header, ...body, '\\unrestrict AbCdEf123', ''].join('\n');

    const out = normalizeDump(dump);

    expect(out).not.toContain('Dumped from');
    expect(out).not.toContain('Dumped by');
    expect(out).not.toContain('restrict');
    expect(out).toContain(['CREATE TABLE public.products (id uuid);   ', '', '', '', 'ALTER TABLE public.products OWNER TO postgres;'].join('\n'));
  });

  it('keeps function bodies byte for byte: a literal with two trailing spaces differs from one without (W256r probe)', () => {
    const fn = (literal: string) => [...header, 'CREATE FUNCTION public.f() RETURNS text', '    LANGUAGE sql', `    AS $$ SELECT '${literal}' $$;`, ''].join('\n');
    const withSpaces = normalizeDump(fn('a  \nb'));
    expect(withSpaces).toContain("SELECT 'a  \nb'");
    expect(withSpaces).not.toBe(normalizeDump(fn('a\nb')));
  });

  it('leaves look-alike lines inside the SQL alone (only the header and the matching key are metadata)', () => {
    const body = ["    AS $$ SELECT '", '-- Dumped from database version 1', '\\unrestrict OtherKey', "' $$;"];
    const out = normalizeDump([...header, 'CREATE FUNCTION public.g() RETURNS text', ...body, '\\unrestrict AbCdEf123', ''].join('\n'));
    expect(out).toContain(body.join('\n'));
  });

  it('is idempotent', () => {
    const once = normalizeDump([...header, 'CREATE TABLE public.a (id int);', '', '', '\\unrestrict AbCdEf123', ''].join('\n'));
    expect(normalizeDump(once)).toBe(once);
  });
});

describe('buildSnapshot', () => {
  it('records the tooling in the header so a CLI/image mismatch is visible in the diff', () => {
    const snap = buildSnapshot({
      cliVersion: '2.109.1',
      serverVersion: '15.8',
      dump: 'CREATE TABLE public.a (id int);\n',
      extras: '-- cron jobs\njob | * * * * * | SELECT 1;\n',
    });
    expect(snap).toMatch(/^-- Sellf schema snapshot/);
    expect(snap).toContain('-- supabase-cli: 2.109.1');
    expect(snap).toContain('-- postgres: 15.8');
    expect(snap.indexOf('CREATE TABLE public.a')).toBeLessThan(snap.indexOf('-- cron jobs'));
    expect(snap.endsWith('\n')).toBe(true);
  });
});

describe('snapshotDiff', () => {
  it('returns null for identical snapshots', () => {
    expect(snapshotDiff('a\nb\n', 'a\nb\n')).toBeNull();
  });

  it('returns a unified diff naming committed vs migrations for a changed schema', () => {
    const diff = snapshotDiff('CREATE TABLE public.a (id int);\n', 'CREATE TABLE public.a (id bigint);\n');
    expect(diff).not.toBeNull();
    expect(diff).toContain('-CREATE TABLE public.a (id int);');
    expect(diff).toContain('+CREATE TABLE public.a (id bigint);');
    expect(diff).toContain('schema.snapshot.sql (committed)');
    expect(diff).toContain('schema from migrations');
  });
});

describe('rewriteConfigForSnapshot', () => {
  const config = [
    'project_id = "sellf-w123"',
    '',
    '[api]',
    'port = 62821',
    '[db]',
    'port = 54322',
    'shadow_port = 54320',
    'major_version = 15',
    '[studio]',
    'api_url = "http://127.0.0.1:62821"',
    '[analytics]',
    'port = 54327',
    'vector_port = 54328',
  ].join('\n');

  it('isolates the throwaway stack: own project id and own ports, same Postgres major', () => {
    const out = rewriteConfigForSnapshot(config, 'sellf-schema-snapshot', '659');
    expect(out).toContain('project_id = "sellf-schema-snapshot"');
    expect(out).toContain('port = 65921');
    expect(out).toContain('port = 65922');
    expect(out).toContain('shadow_port = 65920');
    expect(out).toContain('vector_port = 65928');
    expect(out).toContain('api_url = "http://127.0.0.1:65921"');
    expect(out).toContain('major_version = 15');
    expect(out).not.toMatch(/62821|54322|54320|54327|54328/);
  });
});
