'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import BaseModal from './ui/BaseModal';
import { Product } from '@/types';
import { buildGateSnippet } from '@/lib/loginwall/gate-snippet';

interface GateSnippetModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

type AllowlistStatus = 'loading' | 'configured' | 'empty' | 'error';
type Tab = 'node' | 'php' | 'python' | 'curl';

export default function GateSnippetModal({ isOpen, onClose, product }: GateSnippetModalProps) {
  const t = useTranslations('gateSnippet');
  const [copied, setCopied] = useState(false);
  const [allowlistStatus, setAllowlistStatus] = useState<AllowlistStatus>('loading');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('node');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const run = async () => {
      setAllowlistStatus('loading');
      try {
        const res = await fetch(`/api/admin/embed/allowed-origins?productId=${encodeURIComponent(product.id)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { origins: string[] };
        if (cancelled) return;
        setAllowlistStatus(data.origins.length > 0 ? 'configured' : 'empty');
      } catch {
        if (!cancelled) setAllowlistStatus('error');
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, product.id]);

  const sellfOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const snippet = sellfOrigin ? buildGateSnippet({ slugs: [product.slug], sellfOrigin }) : '';

  const markupExample = [
    `<div data-sellf-product="${product.slug}">`,
    '  <div data-has-access>Content for buyers</div>',
    '  <div data-no-access>Buy CTA for signed-in non-buyers</div>',
    '  <div data-no-session>Log-in CTA for guests</div>',
    '</div>',
    '',
    `<button data-sellf-feature="${product.slug}">Premium action</button>`,
    '',
    '<script>',
    `  // for a real server action, gate it on the verified token:`,
    `  SellfGate.verify("${product.slug}").then(function (ok) { if (ok) runPaidAction(); });`,
    '</script>',
  ].join('\n');

  const clientExample = [
    `SellfGate.verify("${product.slug}").then(function(ok) {`,
    `  if (!ok) return;`,
    `  fetch("/your-endpoint", {`,
    `    method: "POST",`,
    `    headers: {`,
    `      "Content-Type": "application/json",`,
    `      "Authorization": "Bearer " + SellfGate.token,`,
    `    },`,
    `    body: JSON.stringify({ /* your payload */ }),`,
    `  });`,
    `});`,
  ].join('\n');

  const serverExamples: Record<Tab, string> = {
    node: [
      `// Express / Node.js`,
      `app.post("/your-endpoint", async (req, res) => {`,
      `  const token = req.headers["authorization"]; // "Bearer <gate_token>"`,
      `  const r = await fetch("${sellfOrigin}/api/loginwall/verify", {`,
      `    method: "POST",`,
      `    headers: { "Content-Type": "application/json", "Authorization": token },`,
      `    body: JSON.stringify({ product: "${product.slug}" }),`,
      `  });`,
      `  const { access } = await r.json();`,
      `  if (!access) return res.status(403).json({ error: "No access" });`,
      `  // verified — safe to execute`,
      `  res.json({ ok: true });`,
      `});`,
    ].join('\n'),
    php: [
      `// PHP (plain)`,
      `$token = $_SERVER["HTTP_AUTHORIZATION"] ?? "";`,
      `$ctx = stream_context_create(["http" => [`,
      `  "method"  => "POST",`,
      `  "header"  => "Content-Type: application/json\\r\\nAuthorization: $token",`,
      `  "content" => json_encode(["product" => "${product.slug}"]),`,
      `]]);`,
      `$res  = file_get_contents("${sellfOrigin}/api/loginwall/verify", false, $ctx);`,
      `$data = json_decode($res, true);`,
      `if (empty($data["access"])) { http_response_code(403); exit; }`,
      `// verified — safe to execute`,
      ``,
      `// WordPress (wp_remote_post)`,
      `$token = $_SERVER["HTTP_AUTHORIZATION"] ?? "";`,
      `$res = wp_remote_post("${sellfOrigin}/api/loginwall/verify", [`,
      `  "headers" => [`,
      `    "Content-Type"  => "application/json",`,
      `    "Authorization" => $token,`,
      `  ],`,
      `  "body" => json_encode(["product" => "${product.slug}"]),`,
      `]);`,
      `$data = json_decode(wp_remote_retrieve_body($res), true);`,
      `if (empty($data["access"])) {`,
      `  wp_send_json_error("No access", 403); return;`,
      `}`,
      `// verified — safe to execute`,
    ].join('\n'),
    python: [
      `# Flask`,
      `import requests`,
      `from flask import request, abort, jsonify`,
      ``,
      `@app.route("/your-endpoint", methods=["POST"])`,
      `def your_endpoint():`,
      `    token = request.headers.get("Authorization", "")`,
      `    r = requests.post("${sellfOrigin}/api/loginwall/verify",`,
      `        headers={"Content-Type": "application/json",`,
      `                 "Authorization": token},`,
      `        json={"product": "${product.slug}"})`,
      `    if not r.json().get("access"):`,
      `        abort(403)`,
      `    # verified — safe to execute`,
      `    return jsonify({"ok": True})`,
      ``,
      `# Django`,
      `import requests`,
      `from django.http import JsonResponse, HttpResponseForbidden`,
      ``,
      `def your_endpoint(request):`,
      `    token = request.headers.get("Authorization", "")`,
      `    r = requests.post("${sellfOrigin}/api/loginwall/verify",`,
      `        headers={"Content-Type": "application/json",`,
      `                 "Authorization": token},`,
      `        json={"product": "${product.slug}"})`,
      `    if not r.json().get("access"):`,
      `        return HttpResponseForbidden()`,
      `    # verified — safe to execute`,
      `    return JsonResponse({"ok": True})`,
    ].join('\n'),
    curl: [
      `# Copy the token from the browser console:`,
      `#   SellfGate.token`,
      ``,
      `curl -s -X POST ${sellfOrigin}/api/loginwall/verify \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "Authorization: Bearer <paste_token_here>" \\`,
      `  -d '{"product":"${product.slug}"}'`,
      ``,
      `# Expected response: {"access":true}`,
      `# Expired / invalid token: {"access":false}`,
    ].join('\n'),
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'node', label: t('advanced.tabNode') },
    { id: 'php', label: t('advanced.tabPhp') },
    { id: 'python', label: t('advanced.tabPython') },
    { id: 'curl', label: t('advanced.tabCurl') },
  ];

  const handleCopy = async () => {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignored
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} size="lg" closeOnBackdropClick={false}>
      <div className="p-6">
        <h2 className="text-2xl font-bold text-sf-heading mb-1">{t('title')}</h2>
        <p className="text-sm text-sf-muted mb-6">{t('subtitle')}</p>

        <div className="space-y-6">
          <div className="bg-sf-raised p-4 flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-sf-heading">{product.name}</h3>
              <p className="text-sm text-sf-body">{t('slug')}: {product.slug}</p>
            </div>
          </div>

          {allowlistStatus === 'empty' && (
            <div className="bg-sf-warning-soft border border-sf-warning/30 p-4 rounded">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-sf-warning flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-sf-warning">
                  <p className="font-medium">{t('emptyAllowlistTitle')}</p>
                  <p className="mt-1">{t('emptyAllowlistBody')}</p>
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-sf-body">{t('snippetLabel')}</label>
              <button
                type="button"
                onClick={handleCopy}
                className={`px-3 py-1 text-sm transition ${
                  copied ? 'bg-sf-success-soft text-sf-success' : 'bg-sf-accent-soft text-sf-accent hover:bg-sf-accent-soft/80'
                }`}
              >
                {copied ? t('copied') : t('copyCode')}
              </button>
            </div>
            <pre className="bg-gray-900 text-gray-100 p-4 text-sm whitespace-pre-wrap break-all">
              <code>{snippet}</code>
            </pre>
          </div>

          <div>
            <label className="block text-sm font-medium text-sf-body mb-2">{t('markupLabel')}</label>
            <pre className="bg-gray-900 text-gray-100 p-4 text-sm whitespace-pre-wrap break-all">
              <code>{markupExample}</code>
            </pre>
          </div>

          <div className="bg-sf-info-soft p-4">
            <h4 className="font-semibold text-sf-info mb-2">🔒 {t('howItWorksTitle')}</h4>
            <p className="text-sm text-sf-info">{t('howItWorksBody')}</p>
          </div>

          {/* Advanced: server-side verification */}
          <div className="border border-sf-border">
            <button
              type="button"
              onClick={() => setAdvancedOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-sf-body hover:bg-sf-hover transition"
            >
              <span>⚙ {t('advanced.toggle')}</span>
              <svg
                className={`w-4 h-4 text-sf-muted transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {advancedOpen && (
              <div className="px-4 pb-4 border-t border-sf-border space-y-4">
                <p className="text-sm text-sf-muted pt-4">{t('advanced.intro')}</p>

                <div>
                  <p className="text-xs font-semibold text-sf-muted uppercase tracking-wide mb-2">
                    {t('advanced.clientStep')}
                  </p>
                  <pre className="bg-gray-900 text-gray-100 p-4 text-xs whitespace-pre-wrap break-all">
                    <code>{clientExample}</code>
                  </pre>
                </div>

                <div>
                  <p className="text-xs font-semibold text-sf-muted uppercase tracking-wide mb-2">
                    {t('advanced.serverStep')}
                  </p>
                  <div className="flex gap-0 border-b border-gray-700 mb-0">
                    {tabs.map(tab => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-3 py-2 text-xs transition border-b-2 -mb-px ${
                          activeTab === tab.id
                            ? 'border-sf-accent text-sf-accent font-medium bg-gray-900'
                            : 'border-transparent text-gray-400 hover:text-gray-200 bg-gray-900'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-4 text-xs whitespace-pre-wrap break-all">
                    <code>{serverExamples[activeTab]}</code>
                  </pre>
                </div>

                <div className="bg-sf-raised border border-sf-border p-3 text-xs text-sf-muted">
                  <span className="font-semibold text-sf-body">{t('advanced.noteTitle')}: </span>
                  {t('advanced.noteBody')}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end space-x-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sf-body hover:bg-sf-hover transition">
            {t('close')}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="px-4 py-2 bg-sf-accent-bg text-white hover:bg-sf-accent-hover transition"
          >
            {t('copyCode')}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
