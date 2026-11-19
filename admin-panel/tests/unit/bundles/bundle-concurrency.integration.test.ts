import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { getTestDatabaseContainer } from '../../helpers/database-container';

const claims = `SET request.jwt.claims='{"role":"service_role"}';`;
function connection() {
  return ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
}
const sql = (body: string) => execFileSync('docker', [...connection(), '-c', body], { encoding: 'utf8' }).trim();

for (const archiveFirst of [true, false]) {
  it(`serializes membership and archiving (archive first: ${archiveFirst})`, async () => {
    const component = crypto.randomUUID(); const bundle = crypto.randomUUID();
    const name = `bundle_${component.replaceAll('-', '')}`;
    sql(`INSERT INTO public.products(id,name,slug,price,is_bundle) VALUES
      ('${bundle}','Bundle','${bundle}',50,true),('${component}','Component','${component}',20,false);`);
    const archive = `UPDATE public.products SET archived_at=now(),is_active=false WHERE id='${component}';`;
    const replace = `SELECT public.replace_bundle_items('${bundle}',ARRAY['${component}']::uuid[]);`;
    const first = spawn('docker', connection());
    let output = '';
    const ready = new Promise<void>((resolve, reject) => {
      first.stdout.on('data', chunk => { output += chunk; if (output.includes('ready')) resolve(); });
      first.on('error', reject);
      first.on('exit', code => { if (code) reject(new Error(`first connection exited ${code}`)); });
    });
    let second: Promise<{ stdout: string; stderr: string }> | undefined;
    try {
      first.stdin.write(`BEGIN; ${claims} ${archiveFirst ? archive : replace}\n\\echo ready\n`);
      await ready;
      second = promisify(execFile)('docker', [...connection(), '-c', `${claims} SET application_name='${name}'; ${archiveFirst ? replace : archive}`]);
      const rejected = expect(second).rejects.toThrow(archiveFirst ? 'Archived products cannot' : 'Product belongs to bundles');
      await expect.poll(() => sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name='${name}' AND wait_event_type='Lock';`)).toBe('1');
      first.stdin.end('COMMIT;\n');
      await rejected;
      expect(sql(`SELECT archived_at IS NOT NULL FROM public.products WHERE id='${component}';`)).toBe(archiveFirst ? 't' : 'f');
      expect(sql(`SELECT count(*) FROM public.bundle_items WHERE bundle_product_id='${bundle}';`)).toBe(archiveFirst ? '0' : '1');
    } finally {
      if (!first.stdin.writableEnded) first.stdin.end('ROLLBACK;\n');
      await second?.catch(() => {});
      sql(`DELETE FROM public.bundle_items WHERE bundle_product_id='${bundle}'; DELETE FROM public.products WHERE id IN ('${bundle}','${component}');`);
    }
  });
}

it('replaces membership while payment holds pricing and access-reference locks', async () => {
  const component = crypto.randomUUID(), bundle = crypto.randomUUID();
  sql(`INSERT INTO public.products(id,name,slug,price,is_bundle) VALUES
    ('${bundle}','Bundle','${bundle}',50,true),('${component}','Component','${component}',20,false);`);
  const payment = spawn('docker', connection());
  const exited = new Promise<void>(resolve => payment.on('exit', () => resolve()));
  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    payment.stdout.on('data', chunk => { output += chunk; if (output.includes('payment_ready')) resolve(); });
    payment.on('error', reject);
    payment.on('exit', code => { if (code) reject(new Error(`payment exited ${code}`)); });
  });
  try {
    payment.stdin.write(`BEGIN; SELECT id FROM public.products WHERE id='${component}' FOR SHARE;
      SELECT id FROM public.products WHERE id='${bundle}' FOR KEY SHARE;\n\\echo payment_ready\n`);
    await ready;
    await promisify(execFile)('docker', [...connection(), '-c', `${claims} SET statement_timeout='2s'; SELECT public.replace_bundle_items('${bundle}',ARRAY['${component}']::uuid[]);`]);
    expect(sql(`SELECT count(*) FROM public.bundle_items WHERE bundle_product_id='${bundle}';`)).toBe('1');
  } finally {
    payment.stdin.end('ROLLBACK;\n'); await exited;
    sql(`DELETE FROM public.bundle_items WHERE bundle_product_id='${bundle}'; DELETE FROM public.products WHERE id IN ('${bundle}','${component}');`);
  }
});
