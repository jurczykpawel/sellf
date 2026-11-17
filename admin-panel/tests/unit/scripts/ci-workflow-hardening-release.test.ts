import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../../../..');
const workflow = parse(readFileSync(path.join(root, '.github/workflows/build-release.yml'), 'utf8'));
const policy = parse(readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8'));
interface Step { uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, string> }
interface Job { environment?: string; needs?: string[]; permissions?: Record<string, string>; steps: Step[] }
const jobs: Record<string, Job> = workflow.jobs;

describe('release signing stages', () => {
  it('keeps the signing key only in protected jobs without source checkout or package tools', () => {
    const signers = Object.entries(jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.RELEASE_SIGNING_KEY'));
    expect(signers.map(([name]) => name).sort()).toEqual(['sign-build', 'sign-image']);
    for (const [, job] of signers) {
      expect(job.environment).toBe('release');
      expect(job.permissions).toEqual({ contents: 'read' });
      expect(JSON.stringify(job)).not.toMatch(/checkout@|setup-bun@|bun install|npm |npx |scripts\/|source |bash /);
      expect(job.steps.filter(step => step.uses).map(step => step.uses?.split('@')[0])).toEqual([
        'actions/download-artifact', 'actions/upload-artifact',
      ]);
    }
  });
  it('passes versions and digests literally to every shell step', () => {
    for (const job of Object.values(jobs)) {
      for (const step of job.steps) expect(step.run ?? '').not.toContain('${{');
    }
  });
  it('creates a manual release tag at the commit that was built', () => {
    const release = jobs['publish-build'].steps.find(step => step.uses?.startsWith('softprops/'));
    expect(release?.with?.target_commitish).toBe('${{ github.sha }}');
  });
  it('publishes only after signatures are checked with the installed updater key', () => {
    for (const kind of ['build', 'image']) {
      const publish = jobs[`publish-${kind}`];
      expect(publish).toBeDefined();
      expect(publish.needs).toContain(`sign-${kind}`);
      expect(publish.permissions).toEqual({ contents: 'write' });
      const verify = publish.steps.findIndex(step => step.run?.includes('sign-manifest.sh verify'));
      const upload = publish.steps.findIndex(step => step.run?.includes('gh release upload') || step.uses?.startsWith('softprops/'));
      expect(verify).toBeGreaterThan(-1);
      expect(upload).toBeGreaterThan(verify);
      expect(JSON.stringify(publish)).not.toContain('secrets.RELEASE_SIGNING_KEY');
    }
  });
  it.each([
    ['2026.11.1', '1', true],
    ['2026.11.1', '2', false],
    ['2026.11.1-rc.1', '1', false],
    ['2026.11.1-rc.1', '2', false],
  ])('publishes verified archive assets for %s with minimum %s', (version, minimum, legacy) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sellf-release-stages-'));
    const run = (shell: string, env: Record<string, string> = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', shell], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
    });
    try {
      expect(run('openssl genpkey -algorithm ED25519 -out key.pem && openssl pkey -in key.pem -pubout -out public.pem').status).toBe(0);
      const publicKey = readFileSync(path.join(dir, 'public.pem'), 'utf8');
      const scripts = path.join(dir, 'admin-panel/scripts');
      mkdirSync(path.join(scripts, 'ci'), { recursive: true });
      writeFileSync(path.join(scripts, 'upgrade.sh'), `MIN_UPDATER_VERSION=${minimum}\n# release-signing-key:start\n${publicKey}# release-signing-key:end\n`);
      writeFileSync(path.join(scripts, 'release-signing-key.pub.pem'), publicKey);
      for (const file of ['write-release-manifests.sh', 'sign-manifest.sh']) {
        copyFileSync(path.join(root, 'admin-panel/scripts/ci', file), path.join(scripts, 'ci', file));
      }
      writeFileSync(path.join(dir, 'admin-panel/package.json'), JSON.stringify({ version }));
      writeFileSync(path.join(dir, 'sellf-build.tar.gz'), 'archive bytes');
      expect(run('sha256sum sellf-build.tar.gz > sellf-build.tar.gz.sha256').status).toBe(0);
      const producer = jobs.build.steps.find(step => step.run?.includes('write-release-manifests.sh'))!;
      expect(run(producer.run!, { RELEASE_VERSION: `v${version}`, PRERELEASE: String(version.includes('-rc.')) }).status).toBe(0);
      expect(existsSync(path.join(dir, 'sellf-build.manifest'))).toBe(legacy);
      const signing = jobs['sign-build'].steps.find(step => step.env?.RELEASE_SIGNING_KEY)!;
      expect(run(signing.run!, { RELEASE_SIGNING_KEY: readFileSync(path.join(dir, 'key.pem'), 'utf8'), GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: `v${version}`, GITHUB_EVENT_NAME: 'release' }).status).toBe(0);
      const verification = jobs['publish-build'].steps.find(step => step.run?.includes('sign-manifest.sh verify'))!;
      const result = run(verification.run!);
      expect(result.status, result.stderr).toBe(0);
      writeFileSync(path.join(dir, 'sellf-build.tar.gz'), 'different archive');
      expect(run(verification.run!).status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['build', 'image'])('validates every %s manifest before producing signatures', (kind) => {
    const signing = jobs[`sign-${kind}`].steps.find(step => step.env?.RELEASE_SIGNING_KEY)!;
    const dir = mkdtempSync(path.join(tmpdir(), 'sellf-manifest-input-'));
    const name = kind === 'build' ? 'sellf-build.v2.manifest' : 'sellf-image.manifest';
    const content = kind === 'build'
      ? `version=2026.11.1\nsha256=${'a'.repeat(64)}\nmin_updater_version=1\n`
      : `version=2026.11.1\nimage=ghcr.io/example/sellf@sha256:${'b'.repeat(64)}\n`;
    try {
      expect(spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', 'key.pem'], { cwd: dir }).status).toBe(0);
      const env = {
        ...process.env, RELEASE_SIGNING_KEY: readFileSync(path.join(dir, 'key.pem'), 'utf8'),
        GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2026.11.1', GITHUB_EVENT_NAME: 'release', DISPATCH_VERSION: '',
      };
      const run = (overrides = {}) => spawnSync('bash', ['-euo', 'pipefail', '-c', signing.run!], {
        cwd: dir, encoding: 'utf8', env: { ...env, ...overrides },
      });
      const invalid = [
        content.replace('2026.11.1', '2026.11.2'), content.replace(/[ab]{64}/, 'a'.repeat(63)),
        content.replace(/[ab]{64}/, 'a'.repeat(65)), content.replace(/[ab]{64}/, 'g'.repeat(64)),
        ...(kind === 'build' ? [content.replace('min_updater_version=1', 'min_updater_version=0')]
          : [content.replace('image=', 'digest='), content.replace('@sha256:', '@sha512:')]),
        `${content}extra\n`, `${content}\n`, content.trimEnd(), content.replace('version=', 'other='),
        content.split('\n').reverse().join('\n'), content.replace('version=', '\0version='),
      ];
      for (const value of invalid) {
        writeFileSync(path.join(dir, name), value);
        const result = run();
        expect(result.status, value).not.toBe(0);
        expect(existsSync(path.join(dir, `${name}.sig`))).toBe(false);
      }
      writeFileSync(path.join(dir, name), content);
      for (const overrides of [
        { GITHUB_REF_TYPE: 'branch' }, { GITHUB_REF_NAME: '2026.11.1' },
        { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_VERSION: '2026.11.2' },
        { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_VERSION: '' },
      ]) {
        expect(run(overrides).status).not.toBe(0);
        expect(existsSync(path.join(dir, `${name}.sig`))).toBe(false);
      }
      if (kind === 'build') {
        writeFileSync(path.join(dir, 'sellf-build.manifest'), content.replace(/min_updater_version=1\n/, '').replace('2026.11.1', '2026.11.2'));
        expect(run().status).not.toBe(0);
        expect(existsSync(path.join(dir, `${name}.sig`))).toBe(false);
        writeFileSync(path.join(dir, 'sellf-build.manifest'), content.replace(/min_updater_version=1\n/, ''));
        writeFileSync(path.join(dir, name), content.replace('2026.11.1', '2026.11.2'));
        expect(run().status).not.toBe(0);
        expect(existsSync(path.join(dir, 'sellf-build.manifest.sig'))).toBe(false);
        expect(existsSync(path.join(dir, `${name}.sig`))).toBe(false);
        rmSync(path.join(dir, 'sellf-build.manifest'));
        writeFileSync(path.join(dir, name), content);
      }
      expect(signing.env?.DISPATCH_VERSION).toBe('${{ inputs.version }}');
      for (const overrides of [{}, { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_VERSION: '2026.11.1' },
        { GITHUB_EVENT_NAME: 'workflow_dispatch', DISPATCH_VERSION: 'v2026.11.1' }]) {
        const result = run(overrides);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(content);
        expect(readFileSync(path.join(dir, `${name}.sig`))).toHaveLength(64);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['build', 'image'])('signs the exact %s manifest bytes using OpenSSL', (kind) => {
    const signer = jobs[`sign-${kind}`];
    expect(signer).toBeDefined();
    const shell = signer.steps.find(step => step.env?.RELEASE_SIGNING_KEY)?.run;
    expect(shell).toBeTruthy();
    const dir = mkdtempSync(path.join(tmpdir(), 'sellf-sign-stage-'));
    try {
      expect(spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', 'key.pem'], { cwd: dir }).status).toBe(0);
      expect(spawnSync('openssl', ['pkey', '-in', 'key.pem', '-pubout', '-out', 'public.pem'], { cwd: dir }).status).toBe(0);
      const name = kind === 'build' ? 'sellf-build.v2.manifest' : 'sellf-image.manifest';
      const content = kind === 'build'
        ? `version=2026.11.1-rc.1\nsha256=${'a'.repeat(64)}\nmin_updater_version=2\n`
        : `version=2026.11.1-rc.1\nimage=ghcr.io/example/sellf@sha256:${'b'.repeat(64)}\n`;
      writeFileSync(path.join(dir, name), content);
      const run = (key: string) => spawnSync('bash', ['-euo', 'pipefail', '-c', shell!], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_SIGNING_KEY: key, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v2026.11.1-rc.1', GITHUB_EVENT_NAME: 'release' },
      });
      expect(run('').status).not.toBe(0);
      const result = run(readFileSync(path.join(dir, 'key.pem'), 'utf8'));
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(path.join(dir, name), 'utf8')).toBe(content);
      expect(readFileSync(path.join(dir, `${name}.sig`))).toHaveLength(64);
      const verify = () => spawnSync('openssl', ['pkeyutl', '-verify', '-pubin', '-inkey', 'public.pem', '-rawin', '-in', name, '-sigfile', `${name}.sig`], { cwd: dir });
      expect(verify().status).toBe(0);
      writeFileSync(path.join(dir, name), `${content}extra\n`);
      expect(verify().status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('dependency maintenance policy', () => {
  it('groups Bun libraries monthly using the shipped lockfiles', () => {
    const bun = policy.updates.find((update: Record<string, unknown>) => update['package-ecosystem'] === 'bun');
    expect(bun.directories).toEqual(['/admin-panel']);
    expect(bun.schedule.interval).toBe('monthly');
    expect(bun.groups.maintenance.patterns).toEqual(['*']);
    for (const dir of bun.directories) expect(readFileSync(path.join(root, dir, 'bun.lock'), 'utf8')).toContain('lockfileVersion');
  });
  it('checks Actions quarterly and other ecosystems monthly', () => {
    for (const update of policy.updates) {
      expect(update.schedule.interval).toBe(update['package-ecosystem'] === 'github-actions' ? 'quarterly' : 'monthly');
      expect(update['open-pull-requests-limit']).toBe(1);
    }
  });
  it.each([
    ['github_actions', '/', 'version-update:semver-major', 'ci'],
    ['github_actions', '/', 'version-update:semver-minor', 'ci'],
    ['bun', '/admin-panel', 'version-update:semver-major', 'release-batch'],
    ['npm_and_yarn', '/docs-site', 'version-update:semver-major', 'release-batch'],
    ['npm_and_yarn', '/docs-site', 'version-update:semver-patch', 'safe'],
  ])('classifies %s %s %s as %s', (ecosystem, directory, updateType, expected) => {
    const classification = parse(readFileSync(path.join(root, '.github/workflows/dependabot-auto-merge.yml'), 'utf8'));
    const shell = classification.jobs.classify.steps.find((step: { id?: string }) => step.id === 'kind').run;
    const dir = mkdtempSync(path.join(tmpdir(), 'sellf-classify-'));
    try {
      const output = path.join(dir, 'output');
      const result = spawnSync('bash', ['-euo', 'pipefail', '-c', `gh() { printf '%s' '{"body":"","labels":[]}'; }\n${shell}`], {
        encoding: 'utf8', env: { ...process.env, PR_URL: 'example', ECOSYSTEM: ecosystem, DIRECTORY: directory,
          UPDATES: JSON.stringify([{ updateType: 'version-update:semver-patch' }, { updateType }]), GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(output, 'utf8')).toBe(`kind=${expected}\n`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('retains classification and labels without direct merging', () => {
    const source = readFileSync(path.join(root, '.github/workflows/dependabot-auto-merge.yml'), 'utf8');
    expect(source).toContain('id: kind');
    expect(source).toContain('gh pr edit "$PR_URL" --add-label "$LABEL"');
    expect(source).not.toContain('gh pr merge');
    expect(source).not.toContain('DEPENDABOT_AUTOMERGE_PAUSED');
  });
});
