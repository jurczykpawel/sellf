/** Generate the shipped structural schemas. @see spec/contracts/validator-cli.md */
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { configSchema, recipeSchema } from '@/lib/storefront-templates/schemas';

for (const [name, schema] of [['storefront-config', configSchema], ['template-recipe', recipeSchema]] as const) {
  writeFileSync(new URL(`../src/lib/storefront-templates/schema/${name}.schema.json`, import.meta.url), JSON.stringify(z.toJSONSchema(schema), null, 2) + '\n');
}
