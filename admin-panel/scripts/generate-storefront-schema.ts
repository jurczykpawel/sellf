/** Generate storefront and product metadata blocks in their owning migrations. @see spec/contracts/validator-cli.md */
import { readFileSync, writeFileSync } from 'node:fs';
import { toSqlSchema } from './storefront-schema-subset';
import { configSchema } from '@/lib/storefront-templates/schemas';

const migration = new URL('../../supabase/migrations/20261017030527_storefront_c_contract.sql', import.meta.url);
const sql = `CREATE OR REPLACE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '${JSON.stringify(toSqlSchema(configSchema)).replaceAll("'", "''")}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;`;
writeFileSync(migration, readFileSync(migration, 'utf8').replace(/(-- storefront-schema:start[^\n]*\n)[\s\S]*?(-- storefront-schema:end)/, `$1${sql}\n$2`));

