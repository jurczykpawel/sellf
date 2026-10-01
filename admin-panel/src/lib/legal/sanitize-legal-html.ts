/**
 * Legal document HTML sanitizer
 *
 * Generated legal documents (Terms of Service, Privacy Policy) are rendered
 * server-side by parsing the stored HTML into a hast tree, running it through
 * a NARROW allowlist schema, and handing the result to `hast-util-to-jsx-runtime`
 * (never `dangerouslySetInnerHTML`).
 *
 * The allowlist below is derived from the MEASURED output of the legal-engine
 * (see the inventory in the B10 brainstorm — real terms/privacy documents
 * only ever use h1-h4, p, lists, strong/em, code/pre, links, and tables with
 * `align` on th/td and `start` on ol). Everything else — including any inline
 * `id`/`class`/`style`/`title` attribute, or tags like `script`/`svg`/`iframe`/
 * `form`/`meta`/`object`/`embed`/`base` — is stripped, because this document
 * is rendered on the same origin as the admin panel's session cookie
 * (`httpOnly: false`), so untrusted markup here would be able to read it.
 *
 * @see /components/legal/LegalDocument.tsx — consumes sanitizeLegalHtml()
 * @see /app/[locale]/legal/[type]/page.tsx — the page that renders the result
 */

import { fromHtml } from 'hast-util-from-html';
import { sanitize, defaultSchema } from 'hast-util-sanitize';
import type { Schema } from 'hast-util-sanitize';
import type { Root } from 'hast';

export const LEGAL_SCHEMA: Schema = {
  ...defaultSchema,
  tagNames: [
    'h1', 'h2', 'h3', 'h4',
    'p', 'ul', 'ol', 'li',
    'strong', 'em', 'code', 'pre',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'br', 'hr', 'blockquote',
  ],
  attributes: {
    a: ['href'],
    ol: ['start'],
    th: ['align'],
    td: ['align'],
  },
  protocols: {
    href: ['http', 'https', 'mailto', 'tel'],
  },
  strip: ['script', 'style', 'title', 'head', 'noscript', 'template'],
  clobber: [],
  required: {},
  ancestors: defaultSchema.ancestors,
};

/**
 * Parse and sanitize legal-document HTML into a safe hast tree.
 *
 * Accepts either a bare fragment or a full document (the `wrapHtml` output) —
 * `fromHtml` parses either, and `sanitize` drops the `html`/`head`/`body`
 * wrapper elements (they are not in `tagNames`) while keeping their children.
 */
export function sanitizeLegalHtml(html: string): Root {
  const tree = fromHtml(html);
  return sanitize(tree, LEGAL_SCHEMA) as Root;
}
