'use client';

/**
 * Security audit panel for Settings > System tab.
 * Runs diagnostic checks against Supabase configuration and shows
 * actionable warnings for production hardening.
 *
 * @see lib/actions/security-audit.ts
 */

import { useState, useEffect } from 'react';
import { Shield, ShieldCheck, ShieldAlert, AlertTriangle, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { getSecurityAudit, runSecurityAudit } from '@/lib/actions/security-audit';
import type { SecurityCheckResult, SecurityAuditResult } from '@/lib/actions/security-audit';

function CheckIcon({ status }: { status: SecurityCheckResult['status'] }) {
  if (status === 'pass') return <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />;
  if (status === 'fail') return <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />;
  return <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />;
}

function StatusBadge({ status }: { status: SecurityCheckResult['status'] }) {
  const styles = {
    pass: 'bg-green-500/10 text-green-600 border border-green-500/20',
    fail: 'bg-red-500/10 text-red-600 border border-red-500/20',
    warn: 'bg-yellow-500/10 text-yellow-600 border border-yellow-500/20',
  };
  return (
    <span className={`text-xs font-mono px-2 py-0.5 ${styles[status]}`}>
      {status.toUpperCase()}
    </span>
  );
}

function CheckRow({ check }: { check: SecurityCheckResult }) {
  const [expanded, setExpanded] = useState(check.status !== 'pass');
  const hasDetails = check.status !== 'pass' || check.message;

  const borderStyle = check.status === 'pass'
    ? 'border-sf-border-light'
    : check.status === 'fail'
    ? 'border-red-500/30 bg-red-500/5'
    : 'border-yellow-500/30 bg-yellow-500/5';

  return (
    <div className={`border ${borderStyle}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full text-left px-4 py-3"
      >
        <CheckIcon status={check.status} />
        <span className="text-sm font-medium text-sf-heading flex-1">{check.name}</span>
        <StatusBadge status={check.status} />
        {hasDetails && (
          <span className="text-sf-muted ml-2">
            {expanded
              ? <ChevronDown className="w-4 h-4" />
              : <ChevronRight className="w-4 h-4" />
            }
          </span>
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-4 pb-4 space-y-3 border-t border-sf-border-light pt-3">
          {/* What was found */}
          <p className="text-sm text-sf-body">{check.message}</p>

          {/* Step-by-step fix */}
          {check.steps && check.steps.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-sf-heading uppercase tracking-wide">
                How to fix
              </p>
              <ol className="space-y-1.5">
                {check.steps.map((step, i) => {
                  // Lines that start with a number (sub-steps like "1. ..." inside steps) render differently
                  const isSubStep = /^\d+\./.test(step);
                  const isSectionHeader = step.endsWith(':') && !step.includes(' → ') && step.length < 60;
                  if (isSectionHeader) {
                    return (
                      <li key={i} className="text-xs font-semibold text-sf-muted uppercase tracking-wide pt-1">
                        {step}
                      </li>
                    );
                  }
                  if (isSubStep) {
                    return (
                      <li key={i} className="flex gap-2 pl-4">
                        <span className="text-xs text-sf-body">{step}</span>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="flex gap-2.5">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-sf-surface border border-sf-border-light text-xs flex items-center justify-center text-sf-muted font-medium">
                        {i + 1}
                      </span>
                      <span className="text-sm text-sf-body">{step}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {/* Fallback: plain fix text if no steps */}
          {!check.steps && check.fix && (
            <div className="text-sm bg-sf-surface p-3 border border-sf-border-light">
              <span className="font-medium text-sf-heading">How to fix: </span>
              <span className="text-sf-body">{check.fix}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SecurityAuditSettings() {
  const t = useTranslations('securityAudit');
  const [result, setResult] = useState<SecurityAuditResult | null>(null);
  const [running, setRunning] = useState(false);

  // Auto-load cached results on mount
  useEffect(() => {
    let mounted = true;
    setRunning(true);
    getSecurityAudit()
      .then(data => { if (mounted) setResult(data); })
      .catch((err) => { console.warn('[SecurityAuditSettings] Non-critical error:', err); })
      .finally(() => { if (mounted) setRunning(false); });
    return () => { mounted = false; };
  }, []);

  // Force fresh audit (bypass cache)
  async function handleRun() {
    setRunning(true);
    try {
      const data = await runSecurityAudit();
      setResult(data);
    } catch {
      setResult({ success: false, checks: [], timestamp: new Date().toISOString(), error: 'Audit failed' });
    } finally {
      setRunning(false);
    }
  }

  const passCount = result?.checks.filter(c => c.status === 'pass').length ?? 0;
  const warnCount = result?.checks.filter(c => c.status === 'warn').length ?? 0;
  const failCount = result?.checks.filter(c => c.status === 'fail').length ?? 0;

  return (
    <div className="bg-sf-base border-2 border-sf-border-medium p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-sf-muted" />
          <h2 className="text-xl font-semibold text-sf-heading">
            {t('title')}
          </h2>
        </div>

        <button
          onClick={handleRun}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-sf-accent border border-sf-accent/30 hover:bg-sf-accent/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('running')}
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4" />
              {t('runAgain')}
            </>
          )}
        </button>
      </div>

      <p className="text-sm text-sf-muted mb-4">{t('description')}</p>

      {result?.error && (
        <div className="p-3 bg-red-500/5 border border-red-500/30 text-sm text-red-600 mb-4">
          {result.error}
        </div>
      )}

      {result?.success && (
        <>
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-4 text-sm">
            {passCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <ShieldCheck className="w-4 h-4" /> {passCount} {t('passed')}
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-1 text-yellow-600">
                <AlertTriangle className="w-4 h-4" /> {warnCount} {t('warnings')}
              </span>
            )}
            {failCount > 0 && (
              <span className="flex items-center gap-1 text-red-600">
                <ShieldAlert className="w-4 h-4" /> {failCount} {t('issues')}
              </span>
            )}
          </div>

          {/* Check results - issues first, then warnings, then pass */}
          <div className="space-y-2">
            {result.checks
              .sort((a, b) => {
                const order = { fail: 0, warn: 1, pass: 2 };
                return order[a.status] - order[b.status];
              })
              .map(check => (
                <CheckRow key={check.id} check={check} />
              ))
            }
          </div>

          <p className="text-xs text-sf-muted mt-4">
            {t('lastRun')}: {new Date(result.timestamp).toLocaleString()}
          </p>
        </>
      )}

      {!result && !running && (
        <div className="text-sm text-sf-muted italic">
          {t('notRunYet')}
        </div>
      )}
    </div>
  );
}
