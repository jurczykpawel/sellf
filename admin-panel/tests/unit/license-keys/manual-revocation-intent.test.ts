/** Repeating a manual revocation records the seller's permanent decision. */
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const h=vi.hoisted(()=>({rpc:vi.fn(),admin:vi.fn()}));
vi.mock('@/lib/auth-server',()=>({requireAdminApiWithRequest:async()=>({user:{id:'e1210000-0000-4000-a000-000000000001'}})}));
vi.mock('@/lib/rate-limiting',()=>({checkRateLimit:async()=>true}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:h.admin,createPlatformClient:h.admin}));
import { DELETE } from '@/app/api/admin/licenses/[id]/route';
const id='e1210000-0000-4000-a000-000000000002';
beforeEach(()=>{
 vi.clearAllMocks();
 h.rpc.mockResolvedValue({data:[{id,changed:false}],error:null});
 const q={update:()=>q,eq:()=>q,is:()=>q,select:()=>q,maybeSingle:async()=>({data:null,error:null})};
 h.admin.mockReturnValue({rpc:h.rpc,from:()=>q});
});
it('accepts a known license already revoked during the dispute',async()=>{
 const result=await DELETE(new NextRequest('http://localhost/api/admin/licenses/'+id,{method:'DELETE'}),{params:Promise.resolve({id})});
 expect(result.status).toBe(200);expect(await result.json()).toEqual({revoked:true});
 expect(h.rpc).toHaveBeenCalledWith('revoke_issued_licenses',{p_license_ids:[id],p_actor:'e1210000-0000-4000-a000-000000000001'});
});
it('keeps unknown licenses distinct from repeated decisions',async()=>{
 h.rpc.mockResolvedValue({data:[],error:null});
 const result=await DELETE(new NextRequest('http://localhost/api/admin/licenses/'+id,{method:'DELETE'}),{params:Promise.resolve({id})});
 expect(result.status).toBe(404);
});
