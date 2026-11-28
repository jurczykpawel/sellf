/**
 * Supabase Auth refuses a second sign-in mail to one recipient inside `SMTP_MAX_FREQUENCY`: 60 s on Supabase Cloud by
 * default, but only 1 s on the local CLI stack (supabase/config.toml leaves `max_frequency` unset). A test that needs
 * the refusal must hold the interval itself; racing a 1 s window passes on a fast machine and fails on a slower CI
 * runner (W355: J20 went red whenever the second grant came more than a second after the first mail).
 * Both helpers move the recipient's last-mail timestamps in the real local auth schema; nothing in the mail path is mocked.
 * @see src/lib/auth/magic-link/deliver.ts (429 → rate_limited → retry queue)
 */
import { execFileSync } from 'node:child_process';
import { getTestDatabaseContainer } from './database-container';

const TEST_EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+$/i;

function setLastAuthMail(email: string, value: string): void {
  if (!TEST_EMAIL.test(email)) throw new Error('Invalid test email');
  const result = execFileSync('docker', ['exec', '-i', getTestDatabaseContainer(), 'psql', '-U', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: `UPDATE auth.users SET recovery_sent_at = ${value}, confirmation_sent_at = ${value} WHERE email = '${email.toLowerCase()}';`, encoding: 'utf8',
  }).trim();
  // A missing account would turn the hold into a silent no-op and bring the race back.
  if (result !== 'UPDATE 1') throw new Error(`Expected one auth account for the test email, got: ${result}`);
}

/** The recipient's per-address interval is still running for the next few minutes: the next auth mail is refused (429). */
export function holdAuthMailInterval(email: string): void {
  setLastAuthMail(email, `now() + interval '5 minutes'`);
}

/** As if the per-address interval had passed: the next auth mail to the recipient is accepted. */
export function letAuthMailIntervalPass(email: string): void {
  setLastAuthMail(email, `now() - interval '10 minutes'`);
}
