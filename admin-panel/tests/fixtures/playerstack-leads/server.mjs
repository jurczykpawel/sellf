/** Serves the pinned Sellf adapter, email-gate plugin and records signed local webhook requests. */
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
const dist = process.env.PLAYERSTACK_TEST_DIST;
if (!dist) throw new Error('PLAYERSTACK_TEST_DIST must point to a built PlayerStack distribution');
const adapterRepo = process.env.PLAYERSTACK_ADAPTER_REPO;
if (!adapterRepo) throw new Error('PLAYERSTACK_ADAPTER_REPO is required');
const adapterCommit = '8baee66c50a95e21aee91fca66a2edc53bc08538';
const adapterScratch = await mkdtemp(resolve(tmpdir(), 'sellf-lead-adapter-'));
for (const name of ['index.ts', 'normalize.ts']) {
  const source = execFileSync('git', ['-C', adapterRepo, 'show', adapterCommit + ':packages/plugin-sellf-adapter/src/' + name]);
  await writeFile(resolve(adapterScratch, name), source);
}
const adapterBuild = await Bun.build({ entrypoints: [resolve(adapterScratch, 'index.ts')], target: 'browser', format: 'esm' });
if (!adapterBuild.success) throw new Error('Adapter fixture build failed: ' + adapterBuild.logs.join(' '));
const adapterJs = await adapterBuild.outputs[0].text();
const certFile = process.env.LEADS_E2E_CA_FILE;
if (!certFile) throw new Error('LEADS_E2E_CA_FILE is required');
const keyPath = resolve(adapterScratch, 'receiver-key.pem');
const certPath = resolve(adapterScratch, 'receiver-cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath,
  '-days', '1', '-subj', '/CN=w103-receiver.example', '-addext', 'subjectAltName=DNS:w103-receiver.example'], {stdio:'ignore'});
await mkdir(dirname(certFile), {recursive:true});
await writeFile(certFile, await readFile(certPath));
const hooks = [];
const receiver = createHttpsServer({key: await readFile(keyPath), cert: await readFile(certPath)}, async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  hooks.push({headers:request.headers,body}); response.end('ok');
});
receiver.listen(3895, '127.0.0.1');
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:3894');
  if (url.pathname === '/adapter.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(adapterJs); return; }
  if (url.pathname === '/hooks') {
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(hooks)); return;
  }
  if (url.pathname === '/hook' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) body += chunk;
    hooks.push({ headers: request.headers, body }); response.end('ok'); return;
  }
  if (url.pathname.startsWith('/vendor/')) {
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(dist, basename(url.pathname)))); }
    catch { response.writeHead(404).end(); } return;
  }
  if (url.pathname !== '/') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html');
  response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sellf lead form integration</title></head>
<body><main><h1>Video and lead magnet</h1><div id="player" style="position:relative;width:640px;height:420px;background:#111"><video></video></div></main>
<script src="/vendor/playerstack-plugin-email-gate.js"></script><script type="module">
import {createSellfConfigProvider} from "/adapter.js";
(async () => {
  const product = new URL(location.href).searchParams.get('product');
  const base = 'http://localhost:3893';
  const container = document.getElementById('player');
  container.setAttribute('data-sellf-product', product);
  container.setAttribute('src', 'https://files.example.com/lead-video.mp4');
  const provider = createSellfConfigProvider({baseUrl:base,fetchOptions:{credentials:'include'},endpoints:{emailGate:{webhook:base+'/api/leads/submit?product='+encodeURIComponent(product),challenge:base+'/api/leads/challenge'}}});
  const config = await provider.load(container);
  globalThis.adapterConfig = config; globalThis.adapterCommit = '${adapterCommit}';
  const plugin = globalThis[Symbol.for('playerstack.plugin-modules')].get(location.origin + '/vendor/playerstack-plugin-email-gate.js');
  const ctx = {config,container,mediaPlayer:container.querySelector('video'),events:{emit:(name,data)=>{globalThis.lastPlayerEvent={name,data};}}};
  await plugin.init(ctx);
  ctx.mediaPlayer.dispatchEvent(new Event('ended'));
})().catch(error=>{document.body.append('Fixture error: '+error.message); console.error(error);});
</script></body></html>`);
});
server.listen(3894, '127.0.0.1');
async function close() { server.close(); receiver.close(); await rm(adapterScratch, {recursive:true,force:true}); await rm(certFile, {force:true}); }
process.on('SIGTERM', close);
process.on('SIGINT', close);
