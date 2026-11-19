import { execFileSync } from 'node:child_process';
import { getTestDatabaseContainer } from './database-container';

export function archiveLegacyBundleComponent(id: string) {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('Expected product UUID');
  execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN; ALTER TABLE public.products DISABLE TRIGGER keep_bundle_component_available;
      UPDATE public.products SET archived_at=now(),is_active=false WHERE id='${id}';
      ALTER TABLE public.products ENABLE TRIGGER keep_bundle_component_available; COMMIT;`,
    encoding: 'utf8',
  });
}
