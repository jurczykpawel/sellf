/**
 * Playwright global teardown.
 *
 * Runs once after every `playwright test` invocation (i.e. after every shard in
 * scripts/run-pw-sharded.sh, and after any single-spec run). Some specs deactivate
 * every product row to assert empty/filtered storefront states and restore the
 * originally-active set afterwards (see tests/helpers/product-state.ts). If that
 * restore is skipped — the run gets interrupted mid-test — a seed row can be left
 * inactive and poison later tests/runs that assume it's active. This unconditionally
 * puts the known seed products back, regardless of what happened during the run.
 */
import { supabaseAdmin } from './helpers/admin-auth';
import { restoreSeedProductState } from './helpers/product-state';

export default async function globalTeardown(): Promise<void> {
  await restoreSeedProductState(supabaseAdmin);
}
