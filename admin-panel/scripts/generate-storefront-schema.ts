/** Update structural schemas embedded in the unreleased migration. @see spec/contracts/validator-cli.md */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { marketingFieldsShapeSchema } from '@/lib/validations/product-marketing';
import { configSchema } from '@/lib/storefront-templates/schemas';

const migration = new URL('../../supabase/migrations/20261016000000_release_2026_10_6.sql', import.meta.url);
const sql = `CREATE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '${JSON.stringify(z.toJSONSchema(configSchema)).replaceAll("'", "''")}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;`;
writeFileSync(migration, readFileSync(migration, 'utf8').replace(/(-- storefront-schema:start[^\n]*\n)[\s\S]*?(-- storefront-schema:end)/, `$1${sql}\n$2`));

const marketingSql = `ALTER TABLE public.products ADD CONSTRAINT products_marketing_shape
  CHECK (extensions.jsonb_matches_schema('${JSON.stringify(z.toJSONSchema(marketingFieldsShapeSchema)).replaceAll("'", "''")}'::json, marketing_fields));`;
writeFileSync(migration, readFileSync(migration, 'utf8').replace(/(-- marketing-schema:start[^\n]*\n)[\s\S]*?(-- marketing-schema:end)/, `$1${marketingSql}\n$2`));
