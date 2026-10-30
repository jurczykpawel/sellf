/** Event authoring, availability and seeded participant overview. */
import { test, expect } from '@playwright/test';
import { setAuthSession, supabaseAdmin } from './helpers/admin-auth';
import { acceptAllCookies } from './helpers/consent';
import type { Page } from '@playwright/test';
const name = `Event admin ${Date.now()}`;
test.describe.configure({ mode: 'serial' });
test.beforeEach(async ({ page }) => { await acceptAllCookies(page); await setAuthSession(page,'demo@sellf.app','demo123'); await page.goto('/pl/dashboard/products'); });
const copyName = `Event copy ${Date.now()}`;
test.afterAll(async () => { await supabaseAdmin.from('products').delete().in('name',[name,copyName]); });
async function sales(page: Page) {
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:/Dalej/i}).click();
  await dialog.getByRole('button',{name:/Dalej/i}).click();
  await page.locator('[data-step3-group="B"]').getByRole('button').first().click();
  await expect(page.getByRole('region',{name:'Terminy i ceny'})).toBeVisible();
}
async function edit(page: Page, productName: string) {
  const search=page.getByPlaceholder(/Szukaj/i).first(); await search.fill(productName);
  const row=page.locator('tr').filter({hasText:productName});
  await row.locator('button[title*="Edytuj"], button[title*="Edit"]').first().click(); await sales(page);
}
test('creates an event with two tiers and previews thirty seats at the early price @J49',async({page})=>{
  await page.getByRole('button',{name:/Dodaj produkt/i}).click();
  await page.locator('#name').fill(name); await page.locator('#price').fill('67'); await page.locator('#currency').selectOption('PLN');
  await expect(page.locator('#slug')).not.toHaveValue(''); await sales(page);
  await page.getByLabel('Tryb wydarzenia',{exact:true}).check(); await page.getByRole('button',{name:'Dodaj termin',exact:true}).click();
  await page.getByLabel('Początek (strefa wydarzenia)',{exact:true}).fill('2099-01-10T10:00');
  await page.getByLabel('Strefa czasowa',{exact:true}).fill('Europe/Warsaw');
  const tier=page.getByRole('group',{name:'Próg cenowy 1',exact:true});
  await tier.getByLabel('Cena',{exact:true}).fill('47'); await tier.getByLabel('Miejsca w progu (puste: bez limitu)',{exact:true}).fill('30');
  await tier.getByLabel('Koniec sprzedaży (strefa wydarzenia)',{exact:true}).fill('2099-01-09T10:00');
  await page.getByRole('button',{name:'Dodaj próg',exact:true}).click();
  const [removeBox,addBox]=await Promise.all([tier.getByRole('button',{name:'Usuń próg',exact:true}).boundingBox(),page.getByRole('button',{name:'Dodaj próg',exact:true}).boundingBox()]);
  expect(removeBox!.height).toBeLessThanOrEqual(addBox!.height+1);
  const save=page.getByRole('dialog').getByRole('button',{name:/Publikuj/i}); await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole('dialog')).not.toBeVisible(); await edit(page,name);
  const saved = await supabaseAdmin.from('products').select('product_sessions(starts_at,timezone,product_price_tiers(sale_ends_at))').eq('name',name).single();
  expect(saved.error).toBeNull();
  expect(saved.data!.product_sessions[0]).toMatchObject({starts_at: '2099-01-10T09:00:00+00:00',timezone: 'Europe/Warsaw'});
  expect(saved.data!.product_sessions[0].product_price_tiers).toContainEqual(expect.objectContaining({sale_ends_at: '2099-01-09T09:00:00+00:00'}));
  await page.getByRole('button',{name:'Co zobaczy kupujący / zamówienia',exact:true}).click();
  await expect(page.getByText('Zostało 30 miejsc w tej cenie',{exact:true})).toBeVisible();
  await expect(page.getByText('Potem: 67 PLN',{exact:true})).toBeVisible();
});
test('shows seeded sold seats and named participants',async({page})=>{
  await edit(page,'Warsztat automatyzacji');
  await page.getByRole('button',{name:'Co zobaczy kupujący / zamówienia',exact:true}).click();
  await expect(page.getByText('Sprzedane: 2 · Zarezerwowane: 0 · Wolne: 58',{exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'anna.events@example.com',exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'piotr.events@example.com',exact:true})).toBeVisible();
  const response = await page.request.patch('/api/v1/products/e3000000-0000-4000-a000-000000000001', { headers: { Origin: new URL(page.url()).origin }, data: { sessions: [] } });
  expect(response.status()).toBe(409);
});

test('shows a purchased session and private online link to its participant @J50',async({page})=>{
  const email='anna.events@example.com'; const password='Event-test-123456';
  const created=await supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true}); expect(created.error).toBeNull();
  try {
    expect((await supabaseAdmin.from('user_product_access').insert({user_id:created.data.user!.id,product_id:'e3000000-0000-4000-a000-000000000001'})).error).toBeNull();
    await setAuthSession(page,email,password); await page.goto('/pl/p/warsztat-automatyzacji');
    await expect(page.getByRole('link',{name:'Dołącz online',exact:true})).toHaveAttribute('href','https://meet.example.com/workshop-seed');
    await expect(page.getByText('Edycja warsztatowa',{exact:true})).toBeVisible();
    await expect(page.getByText(/Europe\/Warsaw/)).toBeVisible();
  } finally {await supabaseAdmin.auth.admin.deleteUser(created.data.user!.id);}
});

test('duplicates an event product with new sessions and tiers and no reservations @J48',async({page})=>{
  const source='e3000000-0000-4000-a000-000000000001'; const copySlug=`event-copy-${Date.now()}`;
  const before=await supabaseAdmin.from('products').select('product_sessions(id,starts_at,capacity,product_price_tiers(id,label,price,seats))').eq('id',source).single();
  expect(before.error).toBeNull(); expect(before.data!.product_sessions.length).toBeGreaterThan(0);
  await page.getByPlaceholder(/Szukaj/i).first().fill('Warsztat automatyzacji');
  const row=page.locator('tr').filter({hasText:'Warsztat automatyzacji'}).first();
  await row.locator('button[aria-expanded]').click(); await page.locator('button').filter({hasText:/^Duplikuj$/}).first().click();
  await page.locator('#name').fill(copyName); await page.locator('#slug').fill(copySlug);
  const save=page.getByRole('dialog').getByRole('button',{name:/Publikuj/i}); await expect(save).toBeEnabled(); await save.click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const copy=await supabaseAdmin.from('products').select('id,event_mode,product_sessions(id,starts_at,capacity,product_price_tiers(id,label,price,seats))').eq('slug',copySlug).single();
  expect(copy.error).toBeNull(); expect(copy.data!.event_mode).toBe(true);
  const sessions=copy.data!.product_sessions; expect(sessions).toHaveLength(before.data!.product_sessions.length);
  const oldSessionIds=before.data!.product_sessions.map(s=>s.id); const oldTierIds=before.data!.product_sessions.flatMap(s=>s.product_price_tiers.map(t=>t.id));
  for (const s of sessions) { expect(oldSessionIds).not.toContain(s.id); for (const t of s.product_price_tiers) expect(oldTierIds).not.toContain(t.id); }
  const shape=(list:typeof sessions)=>list.map(s=>({starts_at:s.starts_at,capacity:s.capacity,tiers:s.product_price_tiers.map(t=>[t.label,t.price,t.seats]).sort()})).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
  expect(shape(sessions)).toEqual(shape(before.data!.product_sessions));
  const reservations=await supabaseAdmin.from('seat_reservations').select('id').in('session_id',sessions.map(s=>s.id)); expect(reservations.data).toEqual([]);
});

test('rejects creating a product that reuses session ids of another product',async({page})=>{
  const response=await page.request.post('/api/v1/products',{headers:{Origin:new URL(page.url()).origin},data:{name:copyName,slug:`reuse-${Date.now()}`,description:'x',price:10,currency:'PLN',event_mode:true,
    sessions:[{id:'e3000000-0000-4000-a000-000000000002',starts_at:'2099-01-10T09:00:00Z',timezone:'Europe/Warsaw',sort:0,tiers:[{label:'A',price:10,sort:0}]}]}});
  expect(response.status()).toBe(400);
});
