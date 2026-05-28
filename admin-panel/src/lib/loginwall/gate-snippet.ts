import { createHash } from 'node:crypto';

const SLUG_RE = /^[a-z0-9-]{1,96}$/;

export interface GateSnippetInput {
  slugs: string[];
  sellfOrigin: string;
}

function assertInput(input: GateSnippetInput): void {
  if (!input.sellfOrigin) {
    throw new Error('buildGateSnippet: sellfOrigin is required');
  }
  if (!Array.isArray(input.slugs) || input.slugs.length < 1 || input.slugs.length > 20) {
    throw new Error('buildGateSnippet: slugs must be 1-20 entries');
  }
  for (const slug of input.slugs) {
    if (!SLUG_RE.test(slug)) {
      throw new Error(`buildGateSnippet: invalid slug "${slug}"`);
    }
  }
}

export function gateVariableHash(slugs: string[]): string {
  const key = [...slugs].sort().join(',');
  return createHash('sha256').update(`sf-gate:${key}`).digest('hex').slice(0, 12);
}

export function buildGateSnippet(input: GateSnippetInput): string {
  assertInput(input);
  const { slugs, sellfOrigin } = input;
  const products = slugs.join(',');
  const hash = gateVariableHash(slugs);
  const gateBase = `${sellfOrigin}/loginwall/gate?products=${products}`;
  return [
    `<script src="${sellfOrigin}/api/loginwall/gate.js?products=${products}"></script>`,
    `<script>!window._SF_GATE_${hash} && (location.href = "${gateBase}&redirect=" + encodeURIComponent(location.href));</script>`,
    `<noscript><meta http-equiv="refresh" content="0;url=${gateBase}"></noscript>`,
  ].join('\n');
}

export function buildGateScript(input: GateSnippetInput): string {
  assertInput(input);
  const { slugs, sellfOrigin } = input;
  const products = slugs.join(',');
  const hash = gateVariableHash(slugs);
  const flagVar = `_SF_GATE_${hash}`;
  const gateBase = `${sellfOrigin}/loginwall/gate?products=${products}`;
  const verifyUrl = `${sellfOrigin}/api/loginwall/verify`;

  return `(function () {
  if (window._SF_GATE_EXECUTED) return;
  window.${flagVar} = true;
  var raw = location.hash.replace(/^#/, "");
  var pairs = raw ? raw.split("&") : [];
  var tokenIdx = -1;
  for (var i = 0; i < pairs.length; i++) {
    if (pairs[i].indexOf("_sf_token=") === 0) { tokenIdx = i; break; }
  }
  if (tokenIdx === -1) {
    location.href = "${gateBase}&redirect=" + encodeURIComponent(location.href);
    return;
  }
  var token = pairs[tokenIdx].slice("_sf_token=".length);
  pairs.splice(tokenIdx, 1);
  var newHash = pairs.length ? "#" + pairs.join("&") : "";
  history.replaceState(null, document.title, location.pathname + location.search + newHash);
  window.SellfGate = {
    token: token,
    verify: function (slug) {
      return fetch("${verifyUrl}", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ product: slug }),
      }).then(function (r) { return r.json(); }).then(function (d) { return !!(d && d.access); });
    },
  };
  window._SF_GATE_EXECUTED = true;
})();
`;
}
