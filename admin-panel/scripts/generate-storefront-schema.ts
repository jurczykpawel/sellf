/** Update structural schemas embedded in the unreleased migration. @see spec/contracts/validator-cli.md */
import { readFileSync, writeFileSync } from 'node:fs';
import { marketingFieldsShapeSchema } from '@/lib/validations/product-marketing';
import { configSchema } from '@/lib/storefront-templates/schemas';
import { SQL_PATTERNS, toSqlSchema } from './storefront-schema-subset';

const migration = new URL('../../supabase/migrations/20261016000000_release_2026_10_6.sql', import.meta.url);
// Validate both before any write, so an unsupported marketing keyword cannot
// leave a partially regenerated migration. Dialect metadata is not emitted.
const config = toSqlSchema(configSchema);
const marketing = toSqlSchema(marketingFieldsShapeSchema);
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = `CREATE FUNCTION public.storefront_config_schema() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT ${literal(JSON.stringify(config))}::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.storefront_config_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.storefront_config_schema() TO service_role;`;

const marketingSql = `-- Authenticated admins also write products directly under RLS. This pure
-- validation wrapper lets the CHECK invoke the private helpers without exposing
-- a caller-supplied schema or privileged data access.
CREATE FUNCTION public.product_marketing_valid(instance jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path = ''
AS $schema$ SELECT public.jsonschema_subset_matches(${literal(JSON.stringify(marketing))}::json, instance); $schema$;
REVOKE EXECUTE ON FUNCTION public.product_marketing_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.product_marketing_valid(jsonb) TO authenticated, service_role;
ALTER TABLE public.products ADD CONSTRAINT products_marketing_shape
  CHECK (public.product_marketing_valid(marketing_fields));`;
const patternsSql = `CREATE FUNCTION public.jsonschema_subset_pattern(pattern text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $patterns$
  SELECT CASE pattern
${Object.entries(SQL_PATTERNS).map(([pattern, translated]) => `    WHEN ${literal(pattern)} THEN ${literal(translated)}`).join('\n')}
    ELSE NULL END;
$patterns$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) TO service_role;`;
let source = readFileSync(migration, 'utf8');
for (const [block, content] of [['storefront-schema', sql], ['marketing-schema', marketingSql], ['validator-patterns', patternsSql]]) {
  const marker = new RegExp(`(-- ${block}:start[^\\n]*\\n)[\\s\\S]*?(-- ${block}:end)`);
  if (!marker.test(source)) throw new Error(`Missing migration marker: ${block}`);
  // A callback preserves literal '$' sequences from regexes and schema strings.
  source = source.replace(marker, (_, start, end) => `${start}${content}\n${end}`);
}
writeFileSync(migration, source);
