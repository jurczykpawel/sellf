/** Explicit DNS configuration for isolated HTTP acceptance processes. */
const dns = require('node:dns');
const promises = require('node:dns/promises');
const { isIP } = require('node:net');
const { syncBuiltinESMExports } = require('node:module');
if (process.env.TEST_DNS_SERVERS && process.env.E2E_MODE === 'true') {
  const resolver = new promises.Resolver();
  const servers = process.env.TEST_DNS_SERVERS.split(',');
  resolver.setServers(servers); dns.setServers(servers); promises.setServers(servers);
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof options === 'number') options = { family: options };
    options ||= {};
    if (isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost')) return original(hostname, options, callback);
    const family = options.family === 6 ? 6 : 4;
    const resolve = family === 6 ? resolver.resolve6.bind(resolver) : resolver.resolve4.bind(resolver);
    resolve(hostname).then(addresses => {
      const rows = addresses.map(address => ({ address, family }));
      if (options.all) callback(null, rows);
      else callback(null, rows[0].address, rows[0].family);
    }, error => callback(error));
  };
  promises.lookup = (hostname, options) => new Promise((resolve, reject) => dns.lookup(hostname, options, (error, address, family) => error ? reject(error) : resolve(Array.isArray(address) ? address : { address, family })));
  syncBuiltinESMExports();
}
