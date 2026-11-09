import { expect, it, vi } from 'vitest';
const send = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock('@/lib/auth/magic-link/deliver', () => ({ deliverMagicLink: send }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
import { runAuthMailRetries } from '@/lib/auth/magic-link/retry';
it('discards a queued key when its entitlement is no longer current', async () => {
 const deleted = vi.fn().mockResolvedValue({ error: null });
 const db = { rpc: vi.fn(async(name: string) => ({error:null,data: name==='claim_auth_mail_retries' ? [{id:'mail',email:'buyer@example.com',kind:'license',attempts:1,redirect_to:'https://shop.example/auth/callback',data:{license_key:'key.signature'}}] : false})), from: () => ({delete:()=>({eq:deleted})}) };
 expect(await runAuthMailRetries(db as never)).toEqual({processed:1,errors:0});
 expect(send).not.toHaveBeenCalled();
 expect(deleted).toHaveBeenCalledWith('id','mail');
});
