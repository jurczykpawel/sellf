/** Offline storefront checks: template:check -- --config file --json.
 * --recipe file checks a core recipe; --print-schema [config|recipe] and
 * --capabilities print generated authoring contracts. No instance access.
 * @see spec/contracts/validator-cli.md
 */
import { closeSync, openSync, readSync } from 'node:fs';
import { templateCapabilities, templateSchemas } from '@/lib/storefront-templates/capabilities';
import { checkTemplate } from '@/lib/storefront-templates/check';
import { CONFIG_BYTES, parseBoundedJson, result } from '@/lib/storefront-templates/json';
import { validateRecipe } from '@/lib/storefront-templates/registry';
import type { ValidationResult } from '@/lib/storefront-templates/json';

function readInput(path: string): ReturnType<typeof parseBoundedJson> {
  const fd = openSync(path, 'r');
  try {
    const buffer = new Uint8Array(CONFIG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    return parseBoundedJson(buffer.subarray(0, length));
  } finally { closeSync(fd); }
}

function main(): void {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  const json = args.includes('--json');
  const finish = (validation: ValidationResult, status: number): void => {
    // Zod messages may quote unknown keys or enum values; only emit public diagnostics.
    const safe = { ...validation, errors: validation.errors.map(issue => ({ ...issue, message: issue.code === 'SCHEMA' ? 'Value does not match schema' : issue.message })) };
    process.stdout.write(json ? JSON.stringify(safe) + '\n' : `${safe.valid ? 'Valid' : 'Invalid'} offline template\n` + [...safe.errors, ...safe.warnings].map(issue => `${issue.code} ${issue.path || '/'}: ${issue.message}\n`).join(''));
    process.exitCode = status;
  };
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (options.has(arg)) { finish(result([{ code: 'SCHEMA', path: '', message: 'Invalid command options' }]), 2); return; }
    if (['--json', '--capabilities'].includes(arg)) options.set(arg, 'true');
    else if (arg === '--print-schema' && (!args[i + 1] || args[i + 1].startsWith('--'))) options.set(arg, 'config');
    else if (['--config', '--recipe', '--fixture', '--mode', '--print-schema'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options.set(arg, args[++i]);
    else { finish(result([{ code: 'SCHEMA', path: '', message: 'Invalid command options' }]), 2); return; }
  }
  const commands = ['--config', '--recipe', '--print-schema', '--capabilities'].filter(key => options.has(key));
  const mode = options.get('--mode') ?? 'draft';
  if (commands.length !== 1 || !['draft', 'publish'].includes(mode) || (commands[0] !== '--config' && (options.has('--mode') || options.has('--fixture'))) || (options.has('--print-schema') && !['config', 'recipe'].includes(options.get('--print-schema')!))) {
    finish(result([{ code: 'SCHEMA', path: '', message: 'Invalid command options' }]), 2); return;
  }
  if (options.has('--capabilities') || options.has('--print-schema')) {
    const output = options.has('--capabilities') ? templateCapabilities() : templateSchemas()[options.get('--print-schema')!];
    process.stdout.write(JSON.stringify(output, null, 2) + '\n'); return;
  }
  try {
    const input = readInput(options.get(commands[0])!);
    if (!input.valid) { finish(input, 1); return; }
    const fixture = options.has('--fixture') ? readInput(options.get('--fixture')!) : undefined;
    if (fixture && !fixture.valid) { finish({ ...fixture, errors: fixture.errors.map(issue => ({ ...issue, path: '/fixture' + issue.path })) }, 1); return; }
    const checked = options.has('--recipe') ? validateRecipe(input.data) : checkTemplate(input.data, mode as 'draft' | 'publish', fixture?.data);
    finish(checked, checked.valid ? 0 : 1);
  } catch {
    process.stderr.write('Unable to read template input\n');
    finish(result([{ code: 'SCHEMA', path: '', message: 'Unable to read template input' }]), 2);
  }
}
main();
