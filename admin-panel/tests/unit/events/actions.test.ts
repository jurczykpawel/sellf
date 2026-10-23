import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),tier:vi.fn(),rate:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/actions/admin-auth',()=>({withAdminAuth:mocks.auth}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mocks.admin}));
vi.mock('@/lib/supabase/server',()=>({createClient:vi.fn()}));
vi.mock('@/lib/license/resolve',()=>({resolveCurrentTier:mocks.tier}));
vi.mock('@/lib/rate-limiting',()=>({checkRateLimit:mocks.rate,RATE_LIMITS:{ADMIN_EXPORT:{actionType:'export',maxRequests:5,windowMinutes:60}}}));
import { exportEventParticipants, getEventAdmin } from '@/lib/events/actions';
const sid='e3000000-0000-4000-a000-000000000002';
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockImplementation(fn=>fn({user:{id:'admin'}}));mocks.admin.mockReturnValue({rpc:mocks.rpc});mocks.tier.mockResolvedValue('registered');mocks.rate.mockResolvedValue(true);mocks.rpc.mockResolvedValue({data:{orders:[{transaction_id:'tx',status:'confirmed',customer_email:'buyer@example.com'}]},error:null});});
describe('event admin reads and CSV',()=>{
  it('does not initialize a data client when admin authorization fails',async()=>{mocks.auth.mockResolvedValue({success:false,error:'Forbidden'});expect((await getEventAdmin(sid)).success).toBe(false);expect(mocks.admin).not.toHaveBeenCalled();});
  it('uses the existing CSV license requirement',async()=>{mocks.tier.mockResolvedValue('unlicensed');expect((await exportEventParticipants(sid)).success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('applies the existing export rate limit',async()=>{mocks.rate.mockResolvedValue(false);expect((await exportEventParticipants(sid)).success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
  it('exports confirmed participants and excludes held orders',async()=>{mocks.rpc.mockResolvedValue({data:{orders:[{transaction_id:'a',status:'held',customer_email:'held@example.com'},{transaction_id:'b',status:'confirmed',customer_email:'confirmed@example.com'}]},error:null});const r=await exportEventParticipants(sid);expect(r.success).toBe(true);expect(r.data).toContain('confirmed@example.com');expect(r.data).not.toContain('held@example.com');});
  it('rejects malformed session IDs before reading',async()=>{expect((await getEventAdmin('invalid')).success).toBe(false);expect(mocks.rpc).not.toHaveBeenCalled();});
});
