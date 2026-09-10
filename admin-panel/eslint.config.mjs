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

      // No TypeScript escape hatches in production code. Fix the root cause
      // (better types, module augmentation, narrower runtime shape) instead.
      "@typescript-eslint/ban-ts-comment": ["error", {
        "ts-ignore": true,
        "ts-nocheck": true,
        "ts-expect-error": true,
        "ts-check": false,
      }],
    },
  },
  {
    // Tests legitimately use ts-expect-error to assert that invalid inputs are
    // rejected by the type system (edge-case regression guards) and to mock
    // partial Stripe SDK surfaces. Production code must not.
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/auth/magic-link/deliver.ts"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "CallExpression[callee.property.name='signInWithOtp']",
        message: "Magic links are sent only by deliverMagicLink() (src/lib/auth/magic-link/deliver.ts). Browsers use sendMagicLinkRequest().",
      }],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/lib/auth/magic-link/deliver.ts", "src/lib/auth/magic-link/request.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["**/magic-link/deliver", "@/lib/auth/magic-link/deliver"],
          message: "deliverMagicLink() may only be called from src/lib/auth/magic-link/request.ts. Use requestMagicLink() or sendTrustedMagicLink() instead.",
        }],
      }],
    },
  },
]);

export default eslintConfig;
