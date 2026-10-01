/**
 * LegalDocument — renders a sanitized legal-engine document as React elements.
 *
 * No `dangerouslySetInnerHTML`: the stored HTML is parsed into a hast tree,
 * run through `sanitizeLegalHtml` (a narrow allowlist — see
 * `@/lib/legal/sanitize-legal-html`), and handed to `hast-util-to-jsx-runtime`,
 * which builds real React elements from the sanitized tree.
 *
 * Server Component — no client-side JS needed to render static legal text.
 *
 * @see /lib/legal/sanitize-legal-html.ts — the allowlist schema
 * @see /app/[locale]/legal/[type]/page.tsx — the page that renders this
 */

import { Fragment, type AnchorHTMLAttributes } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { sanitizeLegalHtml } from '@/lib/legal/sanitize-legal-html';

/** External links (http/https) open in a new tab with a safe `rel`. */
function SafeLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const isExternal = typeof href === 'string' && /^https?:\/\//i.test(href);
  return (
    <a
      href={href}
      {...rest}
      {...(isExternal ? { target: '_blank', rel: 'noopener nofollow noreferrer' } : {})}
    >
      {children}
    </a>
  );
}

interface LegalDocumentProps {
  /** Raw HTML as stored by publishSnapshot (a fragment, or the wrapHtml()-wrapped document). */
  html: string;
}

export default function LegalDocument({ html }: LegalDocumentProps) {
  const tree = sanitizeLegalHtml(html);
  const content = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components: { a: SafeLink },
  });

  return (
    <div className="prose prose-invert max-w-none space-y-6 text-sf-body">
      {content}
    </div>
  );
}
