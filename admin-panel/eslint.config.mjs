import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**"]),
  {
    rules: {
      // Supabase clients with different schema generics (@supabase/ssr vs @supabase/supabase-js)
      // produce incompatible TypeScript types. Multi-tenant marketplace code REQUIRES `any`
      // to bridge these types. Individual eslint-disable comments are forbidden — this
      // project-level override is the correct way to handle it.
      "@typescript-eslint/no-explicit-any": "off",

      // Allow `declare namespace` for global types coming from external scripts
      // (e.g. YouTube IFrame API exposes `YT.Player`, `YT.PlayerState`). The default
      // `no-namespace` rule blocks this idiom even though it is the canonical way to
      // type third-party globals.
      "@typescript-eslint/no-namespace": ["error", { allowDeclarations: true }],
    },
  },
]);

export default eslintConfig;
