// @vitest-environment happy-dom
/** A seller can keep a dispute-revoked license revoked after resolution. */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import created from '../../fixtures/stripe/charge_dispute_created_needs_response.json';
const h=vi.hoisted(()=>({t:(key:string)=>key}));
vi.mock('next-intl',()=>({useTranslations:()=>h.t,useLocale:()=> 'en'}));
vi.mock('sonner',()=>({toast:{error:vi.fn(),success:vi.fn()}}));
import IssuedLicensesSettings from '@/components/settings/IssuedLicensesSettings';
afterEach(()=>{cleanup();Reflect.deleteProperty(window,'confirm');vi.unstubAllGlobals();vi.restoreAllMocks();});
it('submits a permanent decision for a license already revoked by its dispute',async()=>{
 const row={id:'e1210000-0000-4000-a000-000000000001',product_id:'product-id',email:'buyer@example.com',order_id:created.data.object.payment_intent,kid:'key-id',issued_at:'2026-01-01T00:00:00Z',expires_at:null,revoked_at:'2026-02-01T00:00:00Z',revoked_by_dispute_id:created.data.object.id as string|null,issuance_source:'purchase',license_domain:null,products:{name:'Course',slug:'course',license_tier:'pro'}};
 const fetch=vi.fn(async(_url:string,init?:RequestInit)=>{
  if(init?.method==='DELETE'){row.revoked_by_dispute_id=null;return new Response(JSON.stringify({revoked:true}),{status:200});}
  return new Response(JSON.stringify({licenses:[row],products:[],total:1}),{status:200});
 });
 vi.stubGlobal('fetch',fetch);const confirm=vi.fn(()=>true);Object.defineProperty(window,'confirm',{configurable:true,writable:true,value:confirm});
 render(createElement(IssuedLicensesSettings,{enabled:true}));
 fireEvent.click(await screen.findByTitle('keepRevoked'));
 await waitFor(()=>expect(fetch.mock.calls.some(([url,init])=>url==='/api/admin/licenses/'+row.id&&init?.method==='DELETE')).toBe(true));
 expect(confirm).toHaveBeenCalledWith('confirmKeepRevoked');
 await waitFor(()=>expect(screen.queryByTitle('keepRevoked')).toBeNull());
});
