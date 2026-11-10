/** Revoke a whole order through the shared historical-reference resolver. */
import { describe, it, expect, vi } from 'vitest';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';
describe('permanent order license revocation', () => {
  it('resolves the order and counts only actual changes', async () => {
    const admin={rpc:vi.fn(async()=>({data:[{id:'a',changed:true},{id:'b',changed:false}],error:null}))};
    expect(await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1','cs_1'],reason:'refund'})).toEqual({revoked:1});
    expect(admin.rpc).toHaveBeenCalledWith('revoke_order_licenses',{p_product_id:'product',p_order_ids:['pi_1','cs_1'],p_reason:'refund'});
  });
  it('deduplicates identifiers and avoids empty queries', async () => {
    const admin={rpc:vi.fn(async()=>({data:[],error:null}))};
    await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1','pi_1',null,undefined,''],reason:'refund'});
    expect(admin.rpc).toHaveBeenCalledWith('revoke_order_licenses',{p_product_id:'product',p_order_ids:['pi_1'],p_reason:'refund'});
    admin.rpc.mockClear();
    expect(await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['',null],reason:'refund'})).toEqual({revoked:0});
    expect(admin.rpc).not.toHaveBeenCalled();
  });
  it('reports a failed mutation for redelivery', async () => {
    const admin={rpc:vi.fn(async()=>({data:null,error:{message:'unavailable'}}))};
    await expect(revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1'],reason:'refund'})).rejects.toThrow('License revocation failed');
  });
});
