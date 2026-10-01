import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

// Repo layout: admin-panel/tests/unit/scripts/<this file> -> repo root is four
// levels up (scripts -> unit -> tests -> admin-panel -> root).
const REPO_ROOT = path.resolve(__dirname, '../../../..');

const packageVersion = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'admin-panel/package.json'), 'utf8'),
).version as string;

describe('root docker-compose.yml', () => {
  const composePath = path.join(REPO_ROOT, 'docker-compose.yml');
  const compose = readFileSync(composePath, 'utf8');

  it('exists at the repo root (Coolify/docker compose default lookup path)', () => {
    expect(existsSync(composePath)).toBe(true);
  });

  it('pulls the published image, pinned to a real version by default — never "latest"', () => {
    const match = compose.match(/image:\s*ghcr\.io\/jurczykpawel\/sellf:\$\{SELLF_VERSION:-([^}]+)\}/);
    expect(match).not.toBeNull();
    const defaultTag = match![1];
    expect(defaultTag).not.toBe('latest');
    expect(defaultTag).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("defaults SELLF_VERSION to the version currently in admin-panel/package.json", () => {
    const match = compose.match(/image:\s*ghcr\.io\/jurczykpawel\/sellf:\$\{SELLF_VERSION:-([^}]+)\}/);
    expect(match![1]).toBe(packageVersion);
  });

  it('never references docker-compose.fullstack.yml, .env.fullstack, or supabase/kong.yml', () => {
    expect(compose).not.toMatch(/docker-compose\.fullstack|\.env\.fullstack|supabase\/kong\.yml/);
  });

  it('does not bind the published port to all interfaces by default', () => {
    expect(compose).not.toMatch(/["']?0\.0\.0\.0:\$\{SELLF_PORT/);
    expect(compose).toContain('${SELLF_BIND:-127.0.0.1}:${SELLF_PORT:-3000}:3000');
  });

  it("guards every required secret with compose's required-variable syntax", () => {
    for (const name of [
      'SITE_URL',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'CHECKOUT_BINDING_SECRET',
      'APP_ENCRYPTION_KEY',
      'LOGINWALL_SECRET',
    ]) {
      expect(compose).toMatch(new RegExp(`\\$\\{${name}:\\?`));
    }
  });

  it("healthchecks via node's own fetch — the published image has neither wget nor curl", () => {
    // Only the actual `test:` command array matters here — comments in the
    // healthcheck block are allowed to mention wget/curl while explaining
    // why they're avoided.
    const testMatch = compose.match(/healthcheck:[\s\S]*?test:\s*(\[[\s\S]*?\])/);
    expect(testMatch).not.toBeNull();
    const testCommand = testMatch![1];
    expect(testCommand).not.toMatch(/\bwget\b/);
    expect(testCommand).not.toMatch(/\bcurl\b/);
    expect(testCommand).toContain('"node"');
    expect(testCommand).toContain('/api/health');
  });
});

describe('.env.docker.example', () => {
  const envExamplePath = path.join(REPO_ROOT, '.env.docker.example');
  const envExample = readFileSync(envExamplePath, 'utf8');

  it('documents SELLF_VERSION as the version currently in admin-panel/package.json', () => {
    expect(envExample).toContain(`SELLF_VERSION=${packageVersion}`);
  });

  it('exists and documents every secret the compose file requires', () => {
    expect(existsSync(envExamplePath)).toBe(true);
    for (const name of [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SITE_URL',
      'CHECKOUT_BINDING_SECRET',
      'APP_ENCRYPTION_KEY',
      'LOGINWALL_SECRET',
    ]) {
      expect(envExample).toContain(name);
    }
  });
});

describe('removed self-hosted-Supabase bundle', () => {
  it('deletes docker-compose.fullstack.yml, .env.fullstack.example, supabase/kong.yml, and admin-panel/docker-compose.yml', () => {
    expect(existsSync(path.join(REPO_ROOT, 'docker-compose.fullstack.yml'))).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, '.env.fullstack.example'))).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, 'supabase/kong.yml'))).toBe(false);
    expect(existsSync(path.join(REPO_ROOT, 'admin-panel/docker-compose.yml'))).toBe(false);
  });
});

describe('no stray references to the removed self-hosted-Supabase bundle', () => {
  // full-stack.md intentionally documents the old filenames in its migration
  // section ("Migrating from docker-compose.fullstack.yml") — everything
  // else in the repo must be clean.
  const ALLOWED = new Set(['docs-site/src/content/docs/full-stack.md']);

  const SEARCH_ROOTS = ['docs-site/src/content/docs', 'admin-panel/src', 'admin-panel/scripts', '.github/workflows'];
  const PATTERN = /docker-compose\.fullstack\.yml|\.env\.fullstack|supabase\/kong\.yml/;

  function walk(dir: string): string[] {
    const abs = path.join(REPO_ROOT, dir);
    if (!existsSync(abs)) return [];
    const entries = readdirSync(abs, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(rel);
      if (entry.isSymbolicLink()) return [];
      return [rel];
    });
  }

  it('does not mention the removed bundle files outside the documented migration note', () => {
    const offenders: string[] = [];
    for (const root of SEARCH_ROOTS) {
      for (const rel of walk(root)) {
        if (ALLOWED.has(rel.split(path.sep).join('/'))) continue;
        const content = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
        if (PATTERN.test(content)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('self-hosted magic-link email templates', () => {
  const templatesDir = path.join(REPO_ROOT, 'admin-panel/public/auth-email-templates');
  const files = ['magic-link.html', 'confirmation.html', 'recovery.html', 'invite.html', 'email-change.html'];

  it('serves every GoTrue template as a static file the app itself can host', () => {
    for (const file of files) {
      expect(existsSync(path.join(templatesDir, file))).toBe(true);
    }
  });

  it("keeps the magic-link template carrying TokenHash, which /auth/callback requires", () => {
    const html = readFileSync(path.join(templatesDir, 'magic-link.html'), 'utf8');
    expect(html).toContain('{{ .TokenHash }}');
  });

  it('keeps the public mirror byte-identical to supabase/templates (the source of truth)', () => {
    // supabase/templates/*.html is what supabase/config.toml and the Cloud
    // copy-paste workflow use; admin-panel/public/auth-email-templates/*.html
    // is a REGULAR-FILE mirror (not a symlink) so the app can serve it as a
    // static HTTP asset. Both build-release.yml (tar packaging) and
    // upgrade.sh / stackpilot's release-verify.sh refuse any archive entry
    // that isn't a plain file, and the Dockerfile COPYs supabase/templates
    // into the image — a symlink pointing outside the image's copied tree
    // would dangle. Same pattern as release-signing-key.pub.pem: one file is
    // the source, the other is an auditable copy kept in sync by this test.
    for (const file of files) {
      const sourcePath = path.join(REPO_ROOT, 'supabase/templates', file);
      const mirrorPath = path.join(templatesDir, file);
      expect(readFileSync(mirrorPath)).toEqual(readFileSync(sourcePath));
    }
  });
});

describe('no symlinks under the paths CI packs into a release or a Docker image', () => {
  // build-release.yml's tarball and the Dockerfile's COPY layers both pull
  // from these directories verbatim. admin-panel/scripts/upgrade.sh (and
  // stackpilot's release-verify.sh) refuse any tar entry of type "l"
  // (symlink), and a symlink baked into the Docker image would dangle the
  // moment its target isn't copied into the same image layer. Nothing under
  // these three trees may ever be a symlink.
  const PACKED_ROOTS = ['supabase', 'admin-panel/public', 'admin-panel/scripts'];

  function findSymlinks(dir: string): string[] {
    const abs = path.join(REPO_ROOT, dir);
    if (!existsSync(abs)) return [];
    const entries = readdirSync(abs, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const rel = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) return [rel];
      if (entry.isDirectory()) return findSymlinks(rel);
      return [];
    });
  }

  it('contains no symlinks in supabase/, admin-panel/public/, or admin-panel/scripts/', () => {
    const found = PACKED_ROOTS.flatMap(findSymlinks);
    expect(found).toEqual([]);
  });
});
