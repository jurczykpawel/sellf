/** Generate current C and offer blocks; released RC and A/B snapshots stay frozen.
 * @see docs/templates/phase2-contracts.md
 */
import { configSchema } from '@/lib/storefront-templates/schemas';
import { offerConfigSchema } from '@/lib/storefront-templates/phase2-contracts';
import { readMigrationSource, writeMigrationSource } from './migration-source';
import { assertSqlSchemaSubset, SQL_PATTERNS, toSqlSchema } from './storefront-schema-subset';

const blocks = [
  { file: '20261017030527_storefront_c_contract.sql', block: 'storefront-schema', name: 'storefront_config_schema', replace: true, schema: toSqlSchema(configSchema) },
  { file: '20261016232157_product_offer_snapshots.sql', block: 'offer-schema', name: 'product_offer_config_schema', replace: false, schema: toSqlSchema(offerConfigSchema) },
];
// Check every frozen snapshot too, before any file is written. Unknown keywords,
// formats or patterns must never silently reach a SQL validator that lacks them.
for (const file of ['20261016000000_release_2026_10_6.sql', '20261016223736_storefront_a_contract.sql', '20261017014729_storefront_b_contract.sql']) {
  const source = readMigrationSource(file);
  for (const match of source.matchAll(/AS \$schema\$ SELECT (?:public\.jsonschema_subset_matches\()?'((?:''|[^'])*)'::json/g)) {
    assertSqlSchemaSubset(JSON.parse(match[1].replaceAll("''", "'")));
  }
}
const patternFile = '20261016223736_storefront_a_contract.sql';
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const patterns = `CREATE OR REPLACE FUNCTION public.jsonschema_subset_pattern(pattern text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path = '' AS $patterns$
  SELECT CASE pattern
${Object.entries(SQL_PATTERNS).map(([pattern, translated]) => `    WHEN ${literal(pattern)} THEN ${literal(translated)}`).join('\n')}
    ELSE NULL END;
$patterns$;
REVOKE EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jsonschema_subset_pattern(text) TO service_role;`;
const patternSource = readMigrationSource(patternFile);
const patternMarker = /(-- validator-patterns:start[^\n]*\n)[\s\S]*?(-- validator-patterns:end)/;
if (!patternMarker.test(patternSource)) throw new Error('Missing migration marker: validator-patterns');
const updates = blocks.map(({ file, block, name, replace, schema }) => {
  const source = readMigrationSource(file);
  const marker = new RegExp(`(-- ${block}:start[^\\n]*\\n)[\\s\\S]*?(-- ${block}:end)`);
  if (!marker.test(source)) throw new Error(`Missing migration marker: ${block}`);
  const sql = `CREATE ${replace ? 'OR REPLACE ' : ''}FUNCTION public.${name}() RETURNS json LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = ''
AS $schema$ SELECT '${JSON.stringify(schema).replaceAll("'", "''")}'::json; $schema$;
REVOKE EXECUTE ON FUNCTION public.${name}() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.${name}() TO service_role;`;
  return { file, source: source.replace(marker, (_, start, end) => `${start}${sql}\n${end}`) };
});
updates.push({ file: patternFile, source: patternSource.replace(patternMarker, (_, start, end) => `${start}${patterns}\n${end}`) });
for (const { file, source } of updates) writeMigrationSource(file, source);
