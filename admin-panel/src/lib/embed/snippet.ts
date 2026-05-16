/**
 * Embed snippet builder.
 *
 * Generates the 2-line HTML snippet that sellers paste onto a third-party
 * page. The SDK at /embed/v1/checkout.js reads the data-* attributes and
 * decides how to render (inline checkout vs button + modal).
 *
 * Tested in tests/unit/embed/snippet.test.ts.
 */

export interface EmbedSnippetOptions {
  productSlug: string;
  /** Sellf origin (e.g. https://sellf.tojest.dev). Required. */
  sellfOrigin: string;
  /** When true, render a "Buy" button that opens checkout in a modal. */
  modal?: boolean;
  /** Custom text on the button (only relevant when modal=true). */
  buttonLabel?: string;
  /** Append formatted price to the button label (only when modal=true). */
  showPrice?: boolean;
}

const DATA_ATTR = (key: string, value: string | undefined): string =>
  value && value.length > 0
    ? ` data-${key}="${escapeAttr(value)}"`
    : '';

const DATA_FLAG = (key: string, on: boolean | undefined): string =>
  on === true ? ` data-${key}="true"` : '';

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (ch) => {
    switch (ch) {
      case '&': return '&amp;';
      case '"': return '&quot;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      default: return ch;
    }
  });
}

export function buildEmbedSnippet(opts: EmbedSnippetOptions): string {
  if (!opts.productSlug) throw new Error('productSlug is required');
  if (!opts.sellfOrigin) throw new Error('sellfOrigin is required');

  // Modal-only attributes are emitted only when modal is on — keeps the
  // default inline snippet to 2 short attributes.
  const modalAttrs = opts.modal
    ? `${DATA_FLAG('modal', true)}${DATA_ATTR('button-label', opts.buttonLabel)}${DATA_FLAG('show-price', opts.showPrice)}`
    : '';

  return `<div data-sellf-embed data-product-slug="${escapeAttr(opts.productSlug)}"${modalAttrs}></div>
<script src="${opts.sellfOrigin}/embed/v1/checkout.js"></script>`;
}
