import { describe, it, expect } from 'vitest';

import {
  lintSqlForMissingRevoke,
  lintSqlForTopLevelTransaction,
  lintSqlForUnqualifiedCreate,
} from '@/../scripts/lint-migrations';

describe('lintSqlForMissingRevoke', () => {
  it('ignores plain CREATE OR REPLACE (grants preserved or covered by default privileges)', () => {
    const sql = `
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('flags DROP + CREATE in seller_main without REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.foo();
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['seller_main.foo']);
  });

  it('flags DROP + CREATE in public without REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS public.bar(int);
      CREATE FUNCTION public.bar(p int) RETURNS int AS $$ SELECT $1 $$ LANGUAGE sql;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['public.bar']);
  });

  it('passes when DROP + CREATE has matching REVOKE', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.foo();
      CREATE OR REPLACE FUNCTION seller_main.foo() RETURNS void AS $$ BEGIN NULL; END; $$ LANGUAGE plpgsql;
      REVOKE EXECUTE ON FUNCTION seller_main.foo() FROM PUBLIC, anon, authenticated;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('ignores DROP + CREATE in other schemas (e.g. auth)', () => {
    const sql = `
      DROP FUNCTION IF EXISTS auth.something();
      CREATE OR REPLACE FUNCTION auth.something() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
    `;
    expect(lintSqlForMissingRevoke('test.sql', sql)).toHaveLength(0);
  });

  it('reports multiple DROP + CREATE definitions independently', () => {
    const sql = `
      DROP FUNCTION IF EXISTS seller_main.a();
      DROP FUNCTION IF EXISTS public.b();
      CREATE OR REPLACE FUNCTION seller_main.a() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
      CREATE OR REPLACE FUNCTION public.b() RETURNS void AS $$ BEGIN END $$ LANGUAGE plpgsql;
      REVOKE EXECUTE ON FUNCTION seller_main.a() FROM PUBLIC, anon, authenticated;
    `;
    const missing = lintSqlForMissingRevoke('test.sql', sql);
    expect(missing.map((m) => m.qualified)).toEqual(['public.b']);
  });
});

describe('lintSqlForTopLevelTransaction', () => {
  it('flags top-level BEGIN / COMMIT', () => {
    const sql = `BEGIN;\nGRANT SELECT ON seller_main.foo TO authenticated;\nCOMMIT;`;
    expect(lintSqlForTopLevelTransaction(sql)).toEqual(['BEGIN', 'COMMIT']);
  });

  it('ignores BEGIN / END inside dollar-quoted function bodies', () => {
    const sql = `CREATE FUNCTION seller_main.foo() RETURNS void AS $$\nBEGIN\n  NULL;\nEND;\n$$ LANGUAGE plpgsql;`;
    expect(lintSqlForTopLevelTransaction(sql)).toEqual([]);
  });

  it('ignores BEGIN / END inside named dollar-quoted blocks', () => {
    const sql = `CREATE FUNCTION seller_main.foo() RETURNS void AS $body$\nBEGIN\n  NULL;\nEND;\n$body$ LANGUAGE plpgsql;`;
    expect(lintSqlForTopLevelTransaction(sql)).toEqual([]);
  });

  it('ignores transaction keywords inside SQL comments', () => {
    const sql = `-- BEGIN; this is a comment\n/* COMMIT; also a comment */\nSELECT 1;`;
    expect(lintSqlForTopLevelTransaction(sql)).toEqual([]);
  });

  it('catches a ROLLBACK left at top level', () => {
    const sql = `SELECT 1;\nROLLBACK;`;
    expect(lintSqlForTopLevelTransaction(sql)).toEqual(['ROLLBACK']);
  });
});

describe('lintSqlForUnqualifiedCreate', () => {
  it('flags CREATE FUNCTION without schema prefix', () => {
    const sql = `CREATE OR REPLACE FUNCTION check_rate_limit(p text) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual(['FUNCTION check_rate_limit']);
  });

  it('passes schema-qualified CREATE FUNCTION', () => {
    const sql = `CREATE OR REPLACE FUNCTION public.check_rate_limit(p text) RETURNS boolean AS $$ SELECT true $$ LANGUAGE sql;`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual([]);
  });

  it('flags CREATE TABLE without schema', () => {
    const sql = `CREATE TABLE my_table (id int);`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual(['TABLE my_table']);
  });

  it('ignores CREATE INDEX (parent table carries the schema)', () => {
    const sql = `CREATE INDEX idx_foo ON seller_main.products(id);`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual([]);
  });

  it('ignores CREATE POLICY (target is ON schema.table)', () => {
    const sql = `CREATE POLICY "read" ON seller_main.products FOR SELECT USING (true);`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual([]);
  });

  it('ignores CREATE in comments', () => {
    const sql = `-- CREATE FUNCTION foo() does not exist\nSELECT 1;`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual([]);
  });

  it('ignores CREATE inside a dollar-quoted body', () => {
    const sql = `CREATE FUNCTION public.wrapper() RETURNS void AS $$\nBEGIN\n  EXECUTE 'CREATE TABLE inner (id int)';\nEND;\n$$ LANGUAGE plpgsql;`;
    expect(lintSqlForUnqualifiedCreate(sql)).toEqual([]);
  });
});
