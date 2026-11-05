// @vitest-environment happy-dom
import { createElement } from 'react';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({save:vi.fn()}));
vi.mock('next-intl',()=>{const t=(key:string)=>key;return {useTranslations:()=>t};});
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock('@/lib/actions/shop-config',()=>({getMyShopConfig:async()=>({supabase_buyer_emails:false}),updateShopConfig:h.save}));
import BuyerEmailSettings from '@/components/settings/BuyerEmailSettings';
afterEach(cleanup);
it('immediately reflects the selected channel while saving and restores it on failure',async()=>{
 let finish!:(success:boolean)=>void;
 h.save.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
 const view=render(createElement(BuyerEmailSettings));
 const input=view.getByRole('checkbox') as HTMLInputElement;
 await waitFor(()=>expect(input.disabled).toBe(false));
 fireEvent.click(input);
 expect(input.checked).toBe(true);
 expect(input.disabled).toBe(true);
 expect(h.save).toHaveBeenCalledWith({supabase_buyer_emails:true});
 finish(false);
 await waitFor(()=>{expect(input.checked).toBe(false);expect(input.disabled).toBe(false);});
});
