/** Generate the shipped structural schemas. @see spec/contracts/validator-cli.md */
import { readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { marketingFieldsShapeSchema } from '@/lib/validations/product-marketing';
import { configSchema, recipeSchema } from '@/lib/storefront-templates/schemas';

for (const [name, schema] of [['storefront-config', configSchema], ['template-recipe', recipeSchema]] as const) {
  writeFileSync(new URL(`../src/lib/storefront-templates/schema/${name}.schema.json`, import.meta.url), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n');
}

const migration = new URL('../../supabase/migrations/20261015201528_storefront_templates_phase1.sql', import.meta.url);
const sql = `CREATE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '${JSON.stringify(z.toJSONSchema(configSchema)).replaceAll("'", "''")}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;`;
writeFileSync(migration, readFileSync(migration, 'utf8').replace(/(-- storefront-schema:start[^\n]*\n)[\s\S]*?(-- storefront-schema:end)/, `$1${sql}\n$2`));

const marketingSql = `ALTER TABLE public.products ADD CONSTRAINT products_marketing_shape
  CHECK (extensions.jsonb_matches_schema('${JSON.stringify(z.toJSONSchema(marketingFieldsShapeSchema)).replaceAll("'", "''")}'::json, marketing_fields));`;
writeFileSync(migration, readFileSync(migration, 'utf8').replace(/(-- marketing-schema:start[^\n]*\n)[\s\S]*?(-- marketing-schema:end)/, `$1${marketingSql}\n$2`));
