/** Local HTTPS receiver transport for the dedicated lead E2E server only. */
import dns from 'node:dns/promises';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

if (process.env.LEADS_E2E_TRANSPORT !== '1') throw new Error('Dedicated lead fixture environment required');
const host = 'w103-receiver.example';
const certFile = process.env.LEADS_E2E_CA_FILE;
if (!certFile) throw new Error('LEADS_E2E_CA_FILE is required');
const resolve4 = dns.resolve4.bind(dns);
const resolve6 = dns.resolve6.bind(dns);
dns.resolve4 = async (name, ...args) => name === host ? ['93.184.216.34'] : resolve4(name, ...args);
dns.resolve6 = async (name, ...args) => name === host ? [] : resolve6(name, ...args);
const connect = tls.connect.bind(tls);
tls.connect = function (options, ...args) {
  if (options && typeof options === 'object' && (options.servername === host || options.host === host)) {
    const local = { ...options, host: '127.0.0.1', port: Number(process.env.LEADS_RECEIVER_PORT ?? 3895), servername: host, ca: readFileSync(certFile) };
    delete local.lookup;
    return connect(local, ...args);
  }
  return connect(options, ...args);
};
syncBuiltinESMExports();
