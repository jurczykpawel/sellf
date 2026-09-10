import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer, type Server } from 'http';
import path from 'path';

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.resolve(__dirname, '../../../scripts/verify-auth-captcha.sh');

let server: Server | null = null;

function startServer(responder: (body: unknown) => { status: number; json: unknown }): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        const { status, json } = responder(body);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      });
    });
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

describe('verify-auth-captcha.sh', () => {
  it('exits 0 when Supabase Auth rejects OTP without captcha', async () => {
    const baseUrl = await startServer(() => ({
      status: 400,
      json: { error_code: 'captcha_failed', msg: 'captcha verification failed' },
    }));

    const { stdout } = await execFileAsync('bash', [SCRIPT_PATH, baseUrl, 'anon-key']);
    expect(stdout).toContain('OK: Supabase Auth rejects captcha-less OTP');
  });

  it('exits 1 when Supabase Auth accepts OTP without captcha', async () => {
    const baseUrl = await startServer(() => ({ status: 200, json: {} }));

    await expect(execFileAsync('bash', [SCRIPT_PATH, baseUrl, 'anon-key'])).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining('FAIL: direct OTP accepted without captcha'),
    });
  });

  it('exits 1 for an unrelated error code', async () => {
    const baseUrl = await startServer(() => ({
      status: 500,
      json: { error_code: 'unexpected_failure', msg: 'boom' },
    }));

    await expect(execFileAsync('bash', [SCRIPT_PATH, baseUrl, 'anon-key'])).rejects.toMatchObject({
      code: 1,
    });
  });
});
