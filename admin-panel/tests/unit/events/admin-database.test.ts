/** Event product mutations through the real private RPC. */
import { purchaseEventMail } from '@/lib/events/mail';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const actor = 'dddddddd-0000-4000-a000-000000000000';
let id: string; let sid: string; let tid: string; let tx: string;
const session = { starts_at: '2099-01-10T10:00:00Z', timezone: 'Europe/Warsaw', online_url: 'https://meet.example.com/private', tiers: [{ label: 'Early', price: 47, seats: 30, sort: 0 }, { label: 'Regular', price: 67, sort: 1 }] };
async function sessions() { const r = await db.from('product_sessions').select('id,starts_at,venue,tiers:product_price_tiers(id,label,price,seats,sale_ends_at,sort)').eq('product_id', id); if(r.error) throw r.error; return r.data!; }
async function mutate(data: unknown) { return db.rpc('mutate_product_with_audit', { operation_param: 'UPDATE', product_id: id, actor_id: actor, product_data: data }); }
beforeAll(async () => {
  const r = await db.rpc('mutate_product_with_audit', { operation_param: 'INSERT', product_id: null, actor_id: actor, product_data: { name: 'Admin event', slug: `admin-event-${crypto.randomUUID()}`, price: 67, currency: 'PLN', event_mode: true, sessions: [session] } });
  expect(r.error).toBeNull(); id = r.data![0].id; const rows = await sessions(); sid = rows[0].id; tid = rows[0].tiers.find(t => t.sort === 0)!.id;
});
afterAll(async () => { if(id) { await db.from('payment_transactions').delete().eq('product_id',id); await db.from('products').delete().eq('id',id); } });
describe('event administration persistence', () => {
  it('creates nested sessions atomically and leaves them on omission', async () => { expect(await sessions()).toHaveLength(1); expect((await mutate({ name: 'Updated event' })).error).toBeNull(); expect((await sessions())[0].tiers).toHaveLength(2); });
  it('reorders tiers with stable IDs', async () => { const s = (await sessions())[0]; expect((await mutate({ sessions: [{ ...session, id:sid, tiers: s.tiers.map(t => ({ ...t, sort: 1-t.sort })) }] })).error).toBeNull(); expect((await sessions())[0].tiers.find(t => t.id===tid)!.sort).toBe(1); });
  it('rolls back product changes on invalid session ownership', async () => { const r = await mutate({ name: 'Should roll back', sessions: [{ ...session, id:sid, tiers: [] }] }); expect(r.error).not.toBeNull(); expect((await db.from('products').select('name').eq('id',id).single()).data?.name).toBe('Updated event'); });
  it('confirms seats and retains sold identifiers across date changes', async () => {
    const placed = await db.rpc('place_order',{ p_order:{product_id:id,currency:'PLN',customer_email:'admin-event@example.com',session_id:`cs_test_${crypto.randomUUID().replaceAll('-','')}`,metadata:{event_ip:'127.0.0.9'}},p_lines:[{product_id:id,item_type:'main_product',quantity:2,unit_price:47,total_price:94,discounted_total:94,currency:'PLN',product_name:'Event',session_id:sid}] });
    expect(placed.error).toBeNull(); tx=placed.data.transaction_id; expect((await db.rpc('confirm_event_order',{p_transaction_id:tx})).error).toBeNull();
    const tiers=(await sessions())[0].tiers.map(t=>({...t,label:t.id===tid?'Renamed early tier':t.label}));
    expect((await mutate({sessions:[{...session,id:sid,starts_at:'2099-02-10T10:00:00Z',venue:'New venue',tiers}]})).error).toBeNull();
    const li=await db.from('payment_line_items').select('tier_label,session_starts_at').eq('transaction_id',tx).single(); expect(li.data).toMatchObject({tier_label:'Early',session_starts_at:'2099-01-10T10:00:00+00:00'});
  });
  it('sends the date and online link only to the paid buyer email',async()=>{
    await db.from('payment_transactions').update({status:'completed'}).eq('id',tx);
    expect((await db.from('guest_purchases').insert({product_id:id,customer_email:'admin-event@example.com',transaction_id:tx,transaction_amount:9400})).error).toBeNull();
    expect(await purchaseEventMail('admin-event@example.com',id)).toMatchObject({event_date:expect.stringContaining('2099'),event_online_url:session.online_url});
    expect(await purchaseEventMail('other@example.com',id)).toEqual({});
    await db.from('guest_purchases').delete().eq('transaction_id',tx);
    expect(await purchaseEventMail('admin-event@example.com',id)).toEqual({});
  });
  it('refuses removal of sold sessions and tiers without partial mutation', async () => {
    expect((await mutate({sessions:[]})).error?.code).toBe('23503');
    const tiers=(await sessions())[0].tiers.filter(t=>t.id!==tid);
    expect((await mutate({sessions:[{...session,id:sid,tiers}]})).error?.code).toBe('23503'); expect((await sessions())[0].tiers).toHaveLength(2);
  });
  it('returns authoritative counters and participants, without granting public reads', async () => {
    const r=await db.rpc('event_session_admin',{p_session_id:sid}); expect(r.error).toBeNull(); expect(r.data).toMatchObject({sold:2,held:0,orders:[{customer_email:'admin-event@example.com'}]});
    const anon=createClient(process.env.SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    expect((await anon.rpc('event_session_admin',{p_session_id:sid})).error).not.toBeNull(); expect((await anon.rpc('my_event_sessions',{p_product_id:id})).error).not.toBeNull();
  });
  it('returns private links only to the purchased session buyer or participant with current access',async()=>{
    const users: string[]=[];
    try {
      for(const participant of [true,false]) {
        const email=`event-access-${crypto.randomUUID()}@example.com`;const password='Local-test-123456';
        const created=await db.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const uid=created.data.user!.id;users.push(uid);
        expect((await db.from('user_product_access').insert({user_id:uid,product_id:id})).error).toBeNull();
        if(participant) await db.from('payment_transactions').update({order_details:{participants:{v:1,people:[{first_name:'Anna',last_name:'Nowak',email}]}}}).eq('id',tx);
        const client=createClient(process.env.SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);expect((await client.auth.signInWithPassword({email,password})).error).toBeNull();
        const result=await client.rpc('my_event_sessions',{p_product_id:id});expect(result.error).toBeNull();
        if(participant) {expect(result.data).toMatchObject([{id:sid,online_url:session.online_url}]); await db.from('user_product_access').delete().eq('user_id',uid).eq('product_id',id); expect((await client.rpc('my_event_sessions',{p_product_id:id})).data).toEqual([]);}
        else expect(result.data).toEqual([]);
      }
    } finally {for(const uid of users) await db.auth.admin.deleteUser(uid);}
  });
  it('replaces all unreserved entries, including clearing the list',async()=>{
    await db.from('payment_transactions').delete().eq('id',tx);
    expect((await mutate({sessions:[{...session,title:'Replacement'}]})).error).toBeNull(); expect((await sessions())[0].id).not.toBe(sid);
    expect((await mutate({sessions:[]})).error).toBeNull(); expect(await sessions()).toEqual([]);
  });
});
