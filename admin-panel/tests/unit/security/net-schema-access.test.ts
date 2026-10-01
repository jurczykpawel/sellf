/**
 * The database's outbound HTTP functions (pg_net, schema `net`) must stay out
 * of reach of API callers. The schema is not exposed through the Data API and
 * this codebase never calls net.* functions.
 *
 * Note: on Supabase the net schema is owned by supabase_admin, so a project
 * migration cannot change its function grants; the Data API exposure setting
 * is the barrier this project controls.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('net schema is not exposed through the Data API', () => {
  it('supabase/config.toml does not list net among the exposed API schemas', () => {
    const configPath = path.resolve(process.cwd(), '../supabase/config.toml');
    expect(existsSync(configPath)).toBe(true);

    const config = readFileSync(configPath, 'utf-8');
    const schemasLine = config
      .split('\n')
      .find((line) => /^\s*schemas\s*=/.test(line));

    expect(schemasLine).toBeDefined();

    const schemas = JSON.parse(
      schemasLine!.replace(/^\s*schemas\s*=\s*/, '').replace(/'/g, '"')
    ) as string[];

    expect(schemas).not.toContain('net');
  });

  it('no migration or admin-panel source file calls a net.* function', () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const hit = (dir: string) =>
      execSync(
        `grep -rniE '\\bnet\\.(http_get|http_post|http_delete|http_collect_response|worker_restart|check_worker_is_up)\\b' ${dir} || true`,
        { cwd: repoRoot, encoding: 'utf-8' }
      ).trim();

    expect(hit('supabase/migrations')).toBe('');
    expect(hit('admin-panel/src')).toBe('');
  });
});
