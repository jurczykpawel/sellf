'use client';

import { Database, Key, CheckCircle2, Server, Globe, Terminal, ArrowRight } from 'lucide-react';

function GithubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2 .37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

export type DemoVisualKind =
  | 'github-button'
  | 'github-button-netlify'
  | 'vercel-signin'
  | 'netlify-signin'
  | 'supabase-integration'
  | 'supabase-manual'
  | 'env-form'
  | 'env-form-large'
  | 'build-success'
  | 'build-success-netlify'
  | 'vps-provider'
  | 'terminal-ssh'
  | 'terminal-install'
  | 'terminal-env'
  | 'browser-success';

export function DemoVisual({ kind }: { kind: DemoVisualKind }) {
  switch (kind) {
    case 'github-button':
      return <GitHubDeployButton variant="vercel" />;
    case 'github-button-netlify':
      return <GitHubDeployButton variant="netlify" />;
    case 'vercel-signin':
      return <SignInMock variant="vercel" />;
    case 'netlify-signin':
      return <SignInMock variant="netlify" />;
    case 'supabase-integration':
      return <SupabaseIntegrationMock />;
    case 'supabase-manual':
      return <SupabaseManualMock />;
    case 'env-form':
      return <EnvFormMock count={6} />;
    case 'env-form-large':
      return <EnvFormMock count={11} />;
    case 'build-success':
      return <BuildSuccessMock url="your-shop.vercel.app" accent="zinc" />;
    case 'build-success-netlify':
      return <BuildSuccessMock url="your-shop.netlify.app" accent="teal" />;
    case 'vps-provider':
      return <VpsProviderMock />;
    case 'terminal-ssh':
      return <TerminalMock kind="ssh" />;
    case 'terminal-install':
      return <TerminalMock kind="install" />;
    case 'terminal-env':
      return <TerminalMock kind="env" />;
    case 'browser-success':
      return <BrowserSuccessMock />;
    default:
      return null;
  }
}

/* ─── Mockups ────────────────────────────────────────────── */

function GitHubDeployButton({ variant }: { variant: 'vercel' | 'netlify' }) {
  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono text-sf-muted">
        <GithubMark className="w-3.5 h-3.5" />
        <span>README.md · jurczykpawel/sellf</span>
      </div>
      <div className="rounded-lg border border-sf-border bg-sf-raised/50 p-4 space-y-3">
        <p className="text-sm text-sf-body">## Quick deploy</p>
        <div className="space-y-2">
          {variant === 'vercel' ? (
            <>
              <DeployButtonChip variant="vercel" highlighted />
              <DeployButtonChip variant="netlify" />
            </>
          ) : (
            <>
              <DeployButtonChip variant="vercel" />
              <DeployButtonChip variant="netlify" highlighted />
            </>
          )}
        </div>
      </div>
      <p className="text-xs text-sf-muted italic">↑ click the highlighted button</p>
    </div>
  );
}

function DeployButtonChip({ variant, highlighted = false }: { variant: 'vercel' | 'netlify'; highlighted?: boolean }) {
  if (variant === 'vercel') {
    return (
      <div
        className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold text-white bg-zinc-900 border border-zinc-700 transition-[transform,box-shadow] ${
          highlighted
            ? 'ring-2 ring-sf-accent ring-offset-2 ring-offset-sf-raised shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]'
            : 'opacity-50'
        }`}
      >
        <span className="text-white">▲</span>
        <span>Deploy with Vercel</span>
      </div>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-2 rounded px-3 py-1.5 text-xs font-bold text-white bg-teal-700 border border-teal-600 transition-[transform,box-shadow] ${
        highlighted
          ? 'ring-2 ring-sf-accent ring-offset-2 ring-offset-sf-raised shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]'
          : 'opacity-50'
      }`}
    >
      <span>◇</span>
      <span>Deploy to Netlify</span>
    </div>
  );
}

function SignInMock({ variant }: { variant: 'vercel' | 'netlify' }) {
  const tagBg = variant === 'vercel' ? 'bg-zinc-900' : 'bg-teal-700';
  return (
    <div className="w-full max-w-sm mx-auto space-y-4">
      <div className={`mx-auto w-12 h-12 rounded-xl ${tagBg} flex items-center justify-center text-white font-bold text-xl`}>
        {variant === 'vercel' ? '▲' : '◇'}
      </div>
      <p className="text-center text-sm text-sf-heading font-semibold">
        Sign in to {variant === 'vercel' ? 'Vercel' : 'Netlify'}
      </p>
      <div className="space-y-2">
        <div className="rounded-lg border border-sf-border bg-sf-base p-3 flex items-center gap-3 ring-2 ring-sf-accent ring-offset-2 ring-offset-sf-base shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]">
          <GithubMark className="w-5 h-5 text-sf-heading" />
          <span className="text-sm font-medium text-sf-heading">Continue with GitHub</span>
        </div>
        <div className="rounded-lg border border-sf-border bg-sf-base p-3 opacity-50">
          <span className="text-sm text-sf-muted">Continue with Email</span>
        </div>
      </div>
    </div>
  );
}

function SupabaseIntegrationMock() {
  return (
    <div className="w-full max-w-md mx-auto">
      <div className="flex items-center justify-around gap-2">
        <div className="flex-1 rounded-lg border border-sf-border bg-sf-raised p-4 text-center">
          <div className="mx-auto w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center text-white font-bold mb-2">▲</div>
          <p className="text-xs font-bold text-sf-heading">Vercel</p>
          <p className="text-[10px] text-sf-muted">your shop</p>
        </div>
        <div className="relative flex flex-col items-center text-sf-accent">
          <ArrowRight className="w-5 h-5 animate-[demoNudge_1.4s_ease-in-out_infinite]" />
          <span className="absolute -bottom-5 text-[10px] font-mono text-sf-muted whitespace-nowrap">auto-connect</span>
        </div>
        <div className="flex-1 rounded-lg border-2 border-sf-accent bg-sf-accent-soft p-4 text-center ring-2 ring-sf-accent/40 shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]">
          <div className="mx-auto w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center mb-2">
            <Database className="w-5 h-5 text-white" />
          </div>
          <p className="text-xs font-bold text-sf-heading">Supabase</p>
          <p className="text-[10px] text-sf-muted">free tier</p>
        </div>
      </div>
      <div className="mt-8 inline-block bg-sf-accent-bg text-white text-xs font-bold rounded-full px-4 py-1.5 mx-auto" style={{ display: 'block', textAlign: 'center', width: 'fit-content', margin: '24px auto 0' }}>
        + Add Integration
      </div>
    </div>
  );
}

function SupabaseManualMock() {
  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono text-sf-muted">
        <Database className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
        <span>supabase.com/dashboard</span>
      </div>
      <div className="rounded-lg border-2 border-sf-accent bg-emerald-950/30 p-4 ring-2 ring-sf-accent/30 animate-[demoPulse_1.6s_ease-in-out_infinite]">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-sf-heading">Create new project</span>
          <span className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded">Free</span>
        </div>
      </div>
      <div className="space-y-1.5 text-xs font-mono">
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-sf-base border border-sf-border">
          <span className="text-sf-muted">URL:</span>
          <span className="text-sf-heading">https://xxx.supabase.co</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-sf-base border border-sf-border">
          <span className="text-sf-muted">anon key:</span>
          <span className="text-sf-heading">eyJhbGciOi...</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded bg-sf-base border border-sf-border">
          <span className="text-sf-muted">service key:</span>
          <span className="text-sf-heading">eyJhbGciOi...</span>
        </div>
      </div>
      <p className="text-xs text-sf-muted italic">↑ copy these three values</p>
    </div>
  );
}

function EnvFormMock({ count }: { count: number }) {
  const fields = count === 6
    ? [
        { name: 'STRIPE_PUBLISHABLE_KEY', state: 'paste', value: 'pk_test_...' },
        { name: 'STRIPE_SECRET_KEY', state: 'paste', value: 'sk_test_...' },
        { name: 'STRIPE_WEBHOOK_SECRET', state: 'paste', value: 'whsec_...' },
        { name: 'CHECKOUT_BINDING_SECRET', state: 'gen', value: '$ openssl rand ...' },
        { name: 'APP_ENCRYPTION_KEY', state: 'gen', value: '$ openssl rand ...' },
        { name: 'LOGINWALL_SECRET', state: 'gen', value: '$ openssl rand ...' },
      ]
    : [
        { name: 'SUPABASE_URL', state: 'paste', value: 'https://xxx...' },
        { name: 'SUPABASE_ANON_KEY', state: 'paste', value: 'eyJ...' },
        { name: 'SUPABASE_SERVICE_ROLE_KEY', state: 'paste', value: 'eyJ...' },
        { name: 'STRIPE_PUBLISHABLE_KEY', state: 'paste', value: 'pk_...' },
        { name: 'STRIPE_SECRET_KEY', state: 'paste', value: 'sk_...' },
        { name: 'STRIPE_WEBHOOK_SECRET', state: 'paste', value: 'whsec_...' },
        { name: 'SITE_URL', state: 'paste', value: 'https://...' },
        { name: 'TRUSTED_PROXY', state: 'lit', value: 'true' },
        { name: 'CHECKOUT_BINDING_SECRET', state: 'gen', value: 'random hex' },
        { name: 'APP_ENCRYPTION_KEY', state: 'gen', value: 'random hex' },
        { name: 'LOGINWALL_SECRET', state: 'gen', value: 'random hex' },
      ];

  return (
    <div className="w-full max-w-md mx-auto space-y-2 max-h-[260px] overflow-hidden">
      <div className="text-xs font-mono text-sf-muted mb-2">Environment variables</div>
      {fields.slice(0, 6).map((f, i) => (
        <div
          key={f.name}
          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-mono border border-sf-border bg-sf-base ${
            i === 0 ? 'ring-2 ring-sf-accent shadow-[0_0_16px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]' : ''
          }`}
        >
          <span className="text-sf-heading shrink-0 truncate max-w-[180px]">{f.name}</span>
          <span className="text-sf-muted">=</span>
          <span className="text-sf-accent truncate">{f.value}</span>
        </div>
      ))}
      {fields.length > 6 && (
        <div className="text-xs text-sf-muted italic text-center">+ {fields.length - 6} more</div>
      )}
    </div>
  );
}

function BuildSuccessMock({ url, accent }: { url: string; accent: 'zinc' | 'teal' }) {
  const accentBg = accent === 'zinc' ? 'bg-zinc-900' : 'bg-teal-700';
  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex items-center gap-2 text-sf-success">
          <span className="text-sf-success">✓</span> Installing dependencies (45s)
        </div>
        <div className="flex items-center gap-2 text-sf-success">
          <span className="text-sf-success">✓</span> Building Next.js (1m 38s)
        </div>
        <div className="flex items-center gap-2 text-sf-success">
          <span className="text-sf-success">✓</span> Running migrations (12s)
        </div>
        <div className="flex items-center gap-2 text-sf-success">
          <span className="text-sf-success">✓</span> Deployment ready
        </div>
      </div>
      <div className={`rounded-lg ${accentBg} p-4 ring-2 ring-sf-accent shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]`}>
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-white/60">Your store is live at</p>
            <p className="text-sm font-mono font-bold text-white truncate">{url}</p>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-sf-border-accent bg-sf-accent-soft p-3 flex items-center gap-2.5">
        <Globe className="w-4 h-4 text-sf-accent shrink-0" aria-hidden="true" />
        <p className="text-xs text-sf-body leading-snug">
          <span className="font-semibold text-sf-heading">Custom domain?</span>{' '}
          Settings → Domains → add <span className="font-mono text-sf-accent">yourshop.com</span>. Free SSL, ~5 min.
        </p>
      </div>
    </div>
  );
}

function VpsProviderMock() {
  const providers = [
    { name: 'Hetzner', spec: 'CX22 · 4GB RAM', price: '$5/mo' },
    { name: 'DigitalOcean', spec: 'Basic · 4GB', price: '$6/mo' },
    { name: 'mikr.us', spec: 'Pro · shared', price: '~$9/yr' },
  ];
  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="text-xs font-mono text-sf-muted">Any of these work:</div>
      <div className="space-y-2">
        {providers.map((p, i) => (
          <div
            key={p.name}
            className={`flex items-center gap-3 rounded-lg p-3 border ${
              i === 0
                ? 'border-sf-accent bg-sf-accent-soft ring-2 ring-sf-accent shadow-[0_0_16px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]'
                : 'border-sf-border bg-sf-base'
            }`}
          >
            <Server className="w-5 h-5 text-sf-accent shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sf-heading">{p.name}</p>
              <p className="text-xs text-sf-muted">{p.spec}</p>
            </div>
            <span className="text-xs font-mono font-bold text-sf-accent">{p.price}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalMock({ kind }: { kind: 'ssh' | 'install' | 'env' }) {
  return (
    <div className="w-full max-w-lg mx-auto font-mono text-xs text-emerald-400 bg-zinc-950 rounded-lg p-4 space-y-2 border border-zinc-800">
      {kind === 'ssh' && (
        <>
          <div className="flex items-center gap-2 text-zinc-500">
            <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
            <span>~ $</span>
            <span className="text-emerald-300 font-semibold">ssh root@142.93.10.42</span>
            <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-pulse" />
          </div>
          <div className="text-zinc-400">root@142.93.10.42&apos;s password: <span className="text-zinc-600">••••••</span></div>
          <div className="text-zinc-400">Welcome to Ubuntu 24.04 LTS</div>
          <div className="text-emerald-400">root@vps:~#</div>
        </>
      )}
      {kind === 'install' && (
        <>
          <div className="text-zinc-500 break-all">
            <span>root@vps:~# </span>
            <span className="text-emerald-300 font-semibold">curl -fsSL stackpilot.techskills.academy/sellf | bash -s -- \</span>
          </div>
          <div className="text-zinc-500 break-all pl-4">
            <span className="text-emerald-300 font-semibold">--domain-type=cloudflare --domain=mystore.com</span>
          </div>
          <div className="text-zinc-400 mt-1">▸ Bootstrapping StackPilot…</div>
          <div className="text-zinc-400">📂 Loaded Sellf config (Supabase configured)</div>
          <div className="text-zinc-400">✓ Bun + PM2 installed</div>
          <div className="text-zinc-400">✓ Sellf artifact downloaded (47 MB)</div>
          <div className="text-zinc-400">✓ /opt/stacks/sellf-mystore/admin-panel/.env.local written</div>
          <div className="text-zinc-400">✓ PM2: sellf-mystore online</div>
          <div className="text-zinc-400">✓ Cloudflare DNS: mystore.com → your.server.ip</div>
          <div className="text-emerald-300">✓ Live: https://mystore.com → HTTP 200</div>
        </>
      )}
      {kind === 'env' && (
        <>
          <div className="flex items-center gap-2 text-zinc-500 flex-wrap">
            <span>root@vps:/opt/stacks/sellf-mystore/admin-panel#</span>
            <span className="text-emerald-300 font-semibold">nano .env.local</span>
          </div>
          <div className="mt-2 text-zinc-400 leading-relaxed">
            <div><span className="text-zinc-600"># Supabase — already filled by StackPilot</span></div>
            <div><span className="text-purple-400">SUPABASE_URL</span>=<span className="text-yellow-300">https://xxx.supabase.co</span></div>
            <div className="mt-1"><span className="text-zinc-600"># Stripe — paste yours, then pm2 restart</span></div>
            <div><span className="text-purple-400">STRIPE_PUBLISHABLE_KEY</span>=<span className="text-yellow-300">pk_test_51…</span></div>
            <div><span className="text-purple-400">STRIPE_SECRET_KEY</span>=<span className="text-yellow-300">sk_test_51…</span></div>
            <div><span className="text-purple-400">STRIPE_WEBHOOK_SECRET</span>=<span className="text-yellow-300">whsec_…</span></div>
          </div>
          <div className="mt-2 flex items-center gap-2 text-zinc-500 flex-wrap">
            <span>root@vps:~#</span>
            <span className="text-emerald-300 font-semibold">pm2 restart sellf-mystore</span>
          </div>
          <div className="mt-1 text-zinc-500 italic text-[11px]">Then open https://mystore.com — first signup becomes admin.</div>
        </>
      )}
    </div>
  );
}

function BrowserSuccessMock() {
  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      <div className="rounded-lg border border-sf-border bg-sf-deep p-6 text-center space-y-3 ring-2 ring-sf-accent shadow-[0_0_24px_-4px_var(--sf-accent-glow)] animate-[demoPulse_1.6s_ease-in-out_infinite]">
        <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
          <Globe className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-sf-muted">Live</p>
          <p className="text-sm font-mono font-bold text-sf-heading">your-domain.com</p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[10px] text-sf-success bg-sf-success-soft px-2 py-0.5 rounded-full">
          <Key className="w-3 h-3" /> HTTPS · Let&apos;s Encrypt
        </div>
      </div>
      <p className="text-xs text-sf-muted italic text-center">Your shop. Your domain. Your data.</p>
    </div>
  );
}
