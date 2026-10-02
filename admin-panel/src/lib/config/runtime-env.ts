/** Runtime-only env lookup: do not replace with NEXT_PUBLIC dot access. */
export function readRuntimeEnv(name: string): string | undefined {
  const env = process.env;
  return env[name];
}

/** Reject release dummy hosts and keys, including bare MAIN_DOMAIN values. */
export function isBuildPlaceholder(value: string): boolean {
  return /(?:^|:\/\/)(?:placeholder[.](?:example[.]com|supabase[.]co)|your-domain[.]com)(?::\d+)?(?:[/?#]|$)/i.test(value)
    || /^placeholder-(?:anon)-key$/i.test(value);
}

export function getRuntimeSupabaseUrl(): string | undefined {
  return getUsableRuntimeEnv('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
}

export function getRuntimeSupabaseAnonKey(): string | undefined {
  return getUsableRuntimeEnv('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'ANON_KEY');
}

export function getUsableRuntimeEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = readRuntimeEnv(name)?.trim();
    if (value && !isBuildPlaceholder(value)) return value;
  }
  return undefined;
}
