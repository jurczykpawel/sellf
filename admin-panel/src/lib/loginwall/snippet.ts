import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SnippetInput {
  productId: string;
  sellfOrigin: string;
}

function assertInput(input: SnippetInput): void {
  if (!UUID_RE.test(input.productId)) {
    throw new Error('buildLoginwallSnippet: productId must be a UUID');
  }
  if (!input.sellfOrigin) {
    throw new Error('buildLoginwallSnippet: sellfOrigin is required');
  }
}

export function loginwallVariableHash(productId: string): string {
  return createHash('sha256').update(`sf-lw:${productId}`).digest('hex').slice(0, 12);
}

export function buildLoginwallSnippet(input: SnippetInput): string {
  assertInput(input);
  const { productId, sellfOrigin } = input;
  const hash = loginwallVariableHash(productId);
  const protectBase = `${sellfOrigin}/loginwall/protect?id=${productId}`;
  return [
    `<script src="${sellfOrigin}/api/loginwall/login.js?id=${productId}"></script>`,
    `<script>!window._SF_LW_${hash} && (location.href = "${protectBase}&redirect=" + encodeURIComponent(location.href));</script>`,
    `<noscript><meta http-equiv="refresh" content="0;url=${protectBase}"></noscript>`,
  ].join('\n');
}

export function buildLoginwallScript(input: SnippetInput): string {
  assertInput(input);
  const { productId, sellfOrigin } = input;
  const hash = loginwallVariableHash(productId);
  const flagVar = `_SF_LW_${hash}`;
  const protectBase = `${sellfOrigin}/loginwall/protect?id=${productId}`;

  return `(function () {
  if (window._SF_LOGINWALL_EXECUTED) return;
  window.addEventListener("pageshow", function (e) { if (e.persisted) location.reload(); });
  window.${flagVar} = true;
  var raw = location.hash.replace(/^#/, "");
  var pairs = raw ? raw.split("&") : [];
  var tokenIdx = -1;
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i].indexOf("_sf_token=") === 0) { tokenIdx = i; break; }
  }
  if (tokenIdx === -1) {
    location.href = "${protectBase}&redirect=" + encodeURIComponent(location.href);
    return;
  }
  pairs.splice(tokenIdx, 1);
  var newHash = pairs.length ? "#" + pairs.join("&") : "";
  history.replaceState(null, document.title, location.pathname + location.search + newHash);
  window._SF_LOGINWALL_EXECUTED = true;
})();
`;
}
