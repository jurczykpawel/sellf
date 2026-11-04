/** Refund decisions remain permanent even when a dispute already revoked the license. */
import { describe, it, expect, vi } from 'vitest';
import { revokeLicensesForOrder } from '@/lib/license-keys/revoke';
function adminMock(found={data:[{id:'a'},{id:'b'}] as Array<{id:string}>|null,error:null as unknown},result={data:[{id:'a',changed:true},{id:'b',changed:false}],error:null as unknown}){
 const q={select:vi.fn(()=>q),eq:vi.fn(()=>q),in:vi.fn(async()=>found)};
 const admin={from:vi.fn(()=>q),rpc:vi.fn(async()=>result)};return{admin,q};
}
describe('permanent order license revocation',()=>{
 it('includes already revoked rows and counts only actual status changes',async()=>{
  const {admin,q}=adminMock();const result=await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1','cs_1'],reason:'refund'});
  expect(result).toEqual({revoked:1});expect(q.eq).toHaveBeenCalledWith('product_id','product');expect(q.in).toHaveBeenCalledWith('order_id',['pi_1','cs_1']);
  expect(admin.rpc).toHaveBeenCalledWith('revoke_issued_licenses',{p_license_ids:['a','b'],p_reason:'refund'});
 });
 it('deduplicates identifiers and avoids empty queries',async()=>{
  const {admin,q}=adminMock();await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1','pi_1',null,undefined,''],reason:'refund'});expect(q.in).toHaveBeenCalledWith('order_id',['pi_1']);
  admin.from.mockClear();expect(await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['',null],reason:'refund'})).toEqual({revoked:0});expect(admin.from).not.toHaveBeenCalled();
 });
 it('does not submit a mutation for an unmatched order',async()=>{
  const {admin}=adminMock({data:[],error:null});expect(await revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1'],reason:'refund'})).toEqual({revoked:0});expect(admin.rpc).not.toHaveBeenCalled();
 });
 it.each(['lookup','mutation'])('reports a failed %s for redelivery',async stage=>{
  const {admin}=adminMock(stage==='lookup'?{data:null,error:{message:'unavailable'}}:undefined,{data:[],error:stage==='mutation'?{message:'unavailable'}:null});
  await expect(revokeLicensesForOrder(admin as never,{productId:'product',orderIds:['pi_1'],reason:'refund'})).rejects.toThrow('License revocation failed');
 });
});
